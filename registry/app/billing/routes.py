from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import PlainTextResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.billing import application
from app.billing.application import (
    BillingBlocked,
    BillingError,
    WebhookSignatureError,
)
from app.config import get_settings
from app.db import get_session
from app.identity.application import resolve_cookie_active_user
from app.organizations.application import (
    OrganizationError,
    OrganizationForbidden,
    OrganizationNotFound,
)
from app.organizations.repositories import OrganizationRepository
from app.ratelimit import RateLimitRule, enforce
from app.schemas import (
    BillingPlanRequest,
    BillingTransitionRequest,
    BillingWebhookListResponse,
    OrgBillingResponse,
    WebhookEventRequest,
    WebhookEventResponse,
)

router = APIRouter(prefix="/api/v1")

MANAGE_ROLES = ("owner", "administrator", "billing_manager")


def _map_errors(exc: Exception) -> HTTPException:
    if isinstance(exc, OrganizationNotFound):
        return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    if isinstance(exc, OrganizationForbidden):
        return HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc))
    if isinstance(exc, BillingBlocked):
        return HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=str(exc),
            headers={"X-Billing-Status": exc.status},
        )
    if isinstance(exc, (OrganizationError, BillingError, WebhookSignatureError)):
        return HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    raise exc


async def _org_and_member(session: AsyncSession, slug: str, user, *roles: str):
    org_repo = OrganizationRepository(session)
    org = await org_repo.by_slug(slug)
    if org is None:
        raise OrganizationNotFound(f"organization '{slug}' not found")
    member = await org_repo.membership(org, user.id)
    if member is None:
        raise OrganizationForbidden("not a member of this organization")
    if roles and member.role not in roles:
        raise OrganizationForbidden(
            f"requires role {', '.join(roles)} in organization"
        )
    return org


@router.get("/orgs/{slug}/billing", response_model=OrgBillingResponse)
async def get_org_billing(
    slug: str,
    request: Request,
    session: AsyncSession = Depends(get_session),
    user=Depends(resolve_cookie_active_user),
):
    settings = get_settings()
    enforce(
        request,
        ip_rule=RateLimitRule(settings.account_writes_per_hour, 3600),
        account_rule=RateLimitRule(settings.account_writes_per_hour, 3600),
        account_key=str(user.id),
    )
    try:
        org = await _org_and_member(session, slug, user)
        await application.reconcile_subscription(session, org.id)
        return await application.get_org_billing(session, org.id)
    except OrganizationError as exc:
        raise _map_errors(exc) from exc


@router.post("/orgs/{slug}/billing/transitions", response_model=OrgBillingResponse)
async def transition_billing(
    slug: str,
    req: BillingTransitionRequest,
    request: Request,
    session: AsyncSession = Depends(get_session),
    user=Depends(resolve_cookie_active_user),
):
    settings = get_settings()
    enforce(
        request,
        ip_rule=RateLimitRule(settings.account_writes_per_hour, 3600),
        account_rule=RateLimitRule(settings.account_writes_per_hour, 3600),
        account_key=str(user.id),
    )
    try:
        org = await _org_and_member(session, slug, user, *MANAGE_ROLES)
        sub = await application.subscription_for(session, org.id)
        await application.transition_status(
            session, sub, req.status, actor_id=user.id, reason=req.reason, via="manual"
        )
        await session.commit()
        return await application.get_org_billing(session, org.id)
    except (OrganizationError, BillingError) as exc:
        raise _map_errors(exc) from exc


@router.put("/orgs/{slug}/billing/plan", response_model=OrgBillingResponse)
async def change_org_plan(
    slug: str,
    req: BillingPlanRequest,
    request: Request,
    session: AsyncSession = Depends(get_session),
    user=Depends(resolve_cookie_active_user),
):
    settings = get_settings()
    enforce(
        request,
        ip_rule=RateLimitRule(settings.account_writes_per_hour, 3600),
        account_rule=RateLimitRule(settings.account_writes_per_hour, 3600),
        account_key=str(user.id),
    )
    try:
        org = await _org_and_member(session, slug, user, *MANAGE_ROLES)
        sub = await application.subscription_for(session, org.id)
        await application.change_plan(session, sub, req.plan, actor_id=user.id)
        await session.commit()
        return await application.get_org_billing(session, org.id)
    except (OrganizationError, BillingError) as exc:
        raise _map_errors(exc) from exc


@router.post("/orgs/{slug}/billing/webhooks", response_model=WebhookEventResponse)
async def ingest_webhook(
    slug: str,
    req: WebhookEventRequest,
    request: Request,
    session: AsyncSession = Depends(get_session),
):
    """Idempotent payment-provider webhook ingress.

    No card data is accepted or stored; payloads are event metadata used to
    move the subscription lifecycle. The route is signature-verified when
    ``REGISTRY_BILLING_WEBHOOK_SECRET`` is set and idempotent per
    (provider, event_id).
    """
    settings = get_settings()
    enforce(
        request,
        ip_rule=RateLimitRule(settings.account_writes_per_hour, 3600),
        account_rule=RateLimitRule(settings.account_writes_per_hour, 3600),
        account_key=req.eventId[:64] if req.eventId else "webhook",
    )
    raw_body = await request.body()
    try:
        await application.verify_webhook_signature(
            raw_body, request.headers.get("X-OpenAgentHub-Signature")
        )
        org_repo = OrganizationRepository(session)
        org = await org_repo.by_slug(slug)
        if org is None:
            raise OrganizationNotFound(f"organization '{slug}' not found")
        result = await application.process_webhook(
            session,
            organization_id=org.id,
            provider=req.provider,
            event_id=req.eventId,
            event_type=req.eventType,
            payload=req.payload,
        )
        await session.commit()
        return result
    except (OrganizationError, BillingError, WebhookSignatureError) as exc:
        raise _map_errors(exc) from exc


@router.get("/orgs/{slug}/billing/webhooks", response_model=BillingWebhookListResponse)
async def list_billing_webhooks(
    slug: str,
    request: Request,
    session: AsyncSession = Depends(get_session),
    user=Depends(resolve_cookie_active_user),
):
    settings = get_settings()
    enforce(
        request,
        ip_rule=RateLimitRule(settings.account_writes_per_hour, 3600),
        account_rule=RateLimitRule(settings.account_writes_per_hour, 3600),
        account_key=str(user.id),
    )
    try:
        org = await _org_and_member(session, slug, user, *MANAGE_ROLES)
        items = await application.list_webhook_events(session, org.id)
        return {"items": items}
    except OrganizationError as exc:
        raise _map_errors(exc) from exc


@router.get("/orgs/{slug}/billing/usage-export")
async def export_org_usage(
    slug: str,
    request: Request,
    session: AsyncSession = Depends(get_session),
    user=Depends(resolve_cookie_active_user),
):
    settings = get_settings()
    enforce(
        request,
        ip_rule=RateLimitRule(settings.account_writes_per_hour, 3600),
        account_rule=RateLimitRule(settings.account_writes_per_hour, 3600),
        account_key=str(user.id),
    )
    try:
        org = await _org_and_member(session, slug, user, *MANAGE_ROLES)
        csv_text = await application.export_usage(session, org.id)
        return PlainTextResponse(
            csv_text,
            media_type="text/csv",
            headers={"Content-Disposition": f'attachment; filename="{org.slug}-usage.csv"'},
        )
    except OrganizationError as exc:
        raise _map_errors(exc) from exc
