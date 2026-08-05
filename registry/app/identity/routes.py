from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db import get_session
from app.identity import sessions as sess
from app.identity.application import (
    IdentityError,
    KeyNotFound,
    KeyNotOwned,
    UserNotFound,
    get_current_user,
    issue_token,
    list_signing_keys,
    login_with_github,
    register_signing_key,
    require_active_user,
    require_admin,
    revoke_signing_key,
    suspend_user,
)
from app.identity.models import User
from app.identity.oauth import authorize_url, cookie_value, is_allowed_redirect, make_state_token, verify_state_token
from app.identity.repositories import SessionRepository
from app.identity.sessions import agreements_status
from app.schemas import (
    AgreementsRequest,
    AuthMeResponse,
    DeviceLoginRequest,
    DeviceLoginResponse,
    DevicePollRequest,
    DevicePollResponse,
    GithubExchangeRequest,
    GithubExchangeResponse,
    MeResponse,
    SessionInfo,
    SessionsResponse,
    SignerKeyInfo,
    SuspendRequest,
    UploadKeyRequest,
)

router = APIRouter(prefix="/api/v1")

# The hosted web surfaces need a cookie "auth" layer in addition to bearer.
auth_router = APIRouter()


def _session_info(row) -> SessionInfo:
    return SessionInfo(
        id=row.id,
        audience=row.audience,
        deviceLabel=row.device_label,
        createdAt=row.created_at.isoformat() if row.created_at else "",
        lastUsedAt=row.last_used_at.isoformat() if row.last_used_at else "",
        expiresAt=row.expires_at.isoformat() if row.expires_at else "",
        revoked=row.revoked_at is not None,
    )


def session_list(rows) -> list[SessionInfo]:
    return [_session_info(r) for r in rows]


@router.post("/auth/github", response_model=GithubExchangeResponse)
async def github_login(req: GithubExchangeRequest, session: AsyncSession = Depends(get_session)):
    user = await login_with_github(session, req.code)
    await session.commit()
    await session.refresh(user)
    return GithubExchangeResponse(token=issue_token(user.id, user.username), username=user.username)


@router.post("/keys")
async def upload_key(
    req: UploadKeyRequest,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(require_active_user),
):
    try:
        fingerprint, key_id = await register_signing_key(session, user, req.publicKey, label=req.label, expires_at=req.expiresAt)
    except IdentityError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    await session.commit()
    return {"ok": True, "fingerprint": fingerprint, "id": key_id}


@router.delete("/keys/{key_id}")
async def revoke_key(
    key_id: int,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(require_active_user),
):
    try:
        key = await revoke_signing_key(session, user, key_id)
    except (KeyNotFound, KeyNotOwned) as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    await session.commit()
    return {"ok": True, "fingerprint": key.fingerprint, "revoked": True}


@router.post("/admin/users/{user_id}/suspend")
async def admin_suspend_user(
    user_id: int,
    req: SuspendRequest,
    session: AsyncSession = Depends(get_session),
    actor: User = Depends(require_admin),
):
    try:
        user = await suspend_user(session, actor, user_id, req.suspended)
    except (UserNotFound, IdentityError) as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    await session.commit()
    return {"ok": True, "username": user.username, "status": user.status}


@router.get("/me", response_model=MeResponse)
async def me(session: AsyncSession = Depends(get_session), user: User = Depends(get_current_user)):
    keys = await list_signing_keys(session, user)
    return MeResponse(
        username=user.username,
        role=user.role,
        status=user.status,
        publicKeys=[SignerKeyInfo.from_key(k) for k in keys],
    )


# ---- Hosted web browser session / device authorization endpoints ----

@auth_router.get("/auth/github/start")
async def github_start(redirect_uri: str):
    if not is_allowed_redirect(redirect_uri):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="redirect_uri not allowed")
    state = make_state_token(redirect_uri=redirect_uri)
    return Response(status_code=status.HTTP_302_FOUND, headers={"Location": authorize_url(state, redirect_uri)})


@auth_router.get("/auth/github/callback")
async def github_callback(code: str, state: str):
    data = verify_state_token(state)
    if data is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="invalid or expired state")
    redirect_uri = data.get("r", "")
    if not is_allowed_redirect(redirect_uri):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="redirect_uri not allowed")
    from app.db import get_session_factory

    async with get_session_factory()() as session:
        user = await login_with_github(session, code)
        await session.flush()
        token, _ = await sess.create_session(session, user, audience="web")
        await session.commit()
    r = Response(status_code=status.HTTP_302_FOUND)
    r.headers["location"] = f"{redirect_uri}?ok=1"
    r.headers["set-cookie"] = cookie_value(token)
    return r


@router.post("/auth/devices", response_model=DeviceLoginResponse)
async def create_device(req: DeviceLoginRequest, session: AsyncSession = Depends(get_session)):
    result = await sess.create_device_login(
        session,
        client_name=req.clientName,
        requested_scopes=req.requestedScopes,
        registry_origin=req.registryOrigin,
        mode=req.mode,
    )
    await session.commit()
    return DeviceLoginResponse(
        deviceCode=result["deviceCode"],
        userCode=result["userCode"],
        verificationUri=result["verificationUri"],
        expiresIn=result["expiresIn"],
        interval=result["interval"],
    )


@router.post("/auth/devices/token", response_model=DevicePollResponse)
async def poll_device(req: DevicePollRequest, session: AsyncSession = Depends(get_session)):
    result = await sess.poll_device_login(session, req.deviceCode)
    return DevicePollResponse(**result)


@router.post("/auth/approve")
async def approve_device(user_code: str, request: Request, session: AsyncSession = Depends(get_session)):
    user = await resolve_cookie_user(request, session)
    await sess.approve_device_login(session, user, user_code)
    await session.commit()
    return {"ok": True}


@router.get("/sessions", response_model=SessionsResponse)
async def my_sessions(request: Request, session: AsyncSession = Depends(get_session)):
    user = await resolve_cookie_user(request, session)
    rows = await sess.list_for_user(session, user)
    return SessionsResponse(sessions=session_list(rows))


@router.get("/me/agreements")
async def my_agreements(request: Request, session: AsyncSession = Depends(get_session)):
    user = await resolve_cookie_user(request, session)
    return agreements_status(user)


@router.post("/me/agreements")
async def update_agreements(req: AgreementsRequest, request: Request, session: AsyncSession = Depends(get_session)):
    user = await resolve_cookie_user(request, session)
    result = await sess.accept_agreements(session, user, req.tos, req.privacy, req.publisher)
    await session.commit()
    return result


@router.delete("/sessions/{session_id}", response_model=None)
async def revoke_my_session(session_id: int, request: Request, session: AsyncSession = Depends(get_session)):
    user = await resolve_cookie_user(request, session)
    try:
        await sess.revoke_by_id(session, session_id, user)
    except sess.SessionError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    await session.commit()
    return {"ok": True}


@router.delete("/sessions/me")
async def revoke_current_session(request: Request, session: AsyncSession = Depends(get_session)):
    token = request.headers.get("authorization", "").removeprefix("Bearer ").strip()
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="no credential supplied")
    await sess.session_user(session, token, rotate=False)
    row = await SessionRepository(session).by_token_hash(sess.hash_token(token))
    if row is not None:
        await sess.revoke_by_id(session, row.id, row.user)
        await session.commit()
    return {"ok": True}


@router.post("/logout")
async def logout(request: Request):
    settings = get_settings()
    return Response(
        status_code=200,
        content='{"ok": true}',
        media_type="application/json",
        headers={"set-cookie": f"{settings.session_cookie_name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0"},
    )


async def resolve_cookie_user(request: Request, session: AsyncSession) -> User:
    token = request.cookies.get(get_settings().session_cookie_name)
    if not token:
        bearer = request.headers.get("authorization", "")
        if bearer.startswith("Bearer "):
            user = await _user_from_bearer(bearer.removeprefix("Bearer ").strip(), session)
            if user is not None:
                return user
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="not signed in")
    user, _ = await sess.session_user(session, token)
    return user


async def _user_from_bearer(token: str, session: AsyncSession) -> User | None:
    from app.identity.application import decode_token, _user_from_session

    try:
        payload = decode_token(token)
        user_id = int(payload["sub"])
        user = await session.get(User, user_id)
        if user is not None:
            return user
    except (HTTPException, KeyError, ValueError):
        pass
    return await _user_from_session(session, token)