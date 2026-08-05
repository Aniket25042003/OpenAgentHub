import asyncio

from app.outbox.worker import JobWorker


class NotificationWorker(JobWorker):
    """Entrypoint for notification/webhook delivery.

    No producers exist yet; later milestones enqueue notification.send jobs.
    """

    job_type = "notification.send"

    async def handle(self, session, payload: dict) -> None:
        raise NotImplementedError("notification handlers are not implemented yet")


async def main() -> None:
    worker = NotificationWorker()
    await worker.run_forever()


if __name__ == "__main__":
    asyncio.run(main())
