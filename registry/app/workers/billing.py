import asyncio

from app.outbox.worker import JobWorker


class BillingWorker(JobWorker):
    """Entrypoint for billing reconciliation.

    No producers exist yet; later milestones enqueue billing.reconcile jobs.
    """

    job_type = "billing.reconcile"

    async def handle(self, session, payload: dict) -> None:
        raise NotImplementedError("billing handlers are not implemented yet")


async def main() -> None:
    worker = BillingWorker()
    await worker.run_forever()


if __name__ == "__main__":
    asyncio.run(main())
