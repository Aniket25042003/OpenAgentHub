import asyncio

from sqlalchemy import select

from app.billing import application
from app.billing.models import OrganizationSubscription
from app.outbox.worker import JobWorker


class BillingWorker(JobWorker):
    """Reconciles subscription lifecycle state.

    ``billing.reconcile`` jobs advance time-based transitions (trial/grace
    expiry -> past_due, past_due -> suspended). Reconcile never deletes
    artifacts; it only moves lifecycle state.
    """

    job_type = "billing.reconcile"

    async def handle(self, session, payload: dict) -> None:
        organization_ids: list[int] = []
        if payload.get("organizationId"):
            organization_ids.append(int(payload["organizationId"]))
        else:
            rows = (
                await session.execute(
                    select(OrganizationSubscription.organization_id)
                )
            ).scalars().all()
            organization_ids = list(rows)
        for organization_id in organization_ids:
            await application.reconcile_subscription(session, organization_id)


async def main() -> None:
    worker = BillingWorker()
    await worker.run_forever()


if __name__ == "__main__":
    asyncio.run(main())