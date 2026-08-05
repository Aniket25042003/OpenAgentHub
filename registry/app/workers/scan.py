import asyncio

from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.outbox.worker import JobWorker
from app.security_review.adapters import RegistryScanStore
from app.security_review.application import ScanTargetMissing, scan_version_by_id
from app.telemetry import get_logger

log = get_logger("workers.scan")


class ScanWorker(JobWorker):
    """Executes archive safety scans for scan.run jobs (hostile input isolation lives in deployment)."""

    job_type = "scan.run"

    def __init__(self, *args, **kwargs) -> None:
        super().__init__(*args, **kwargs)
        self.scan_store = RegistryScanStore()

    async def handle(self, session: AsyncSession, payload: dict) -> None:
        version_id = payload.get("version_id")
        if version_id is None:
            raise ValueError("scan.run payload missing version_id")
        status, findings = await scan_version_by_id(session, int(version_id), get_settings().max_archive_bytes, self.scan_store)
        log.info("scan finished for version %s: %s (%d findings)", version_id, status, len(findings))


async def main() -> None:
    worker = ScanWorker()
    await worker.run_forever()


if __name__ == "__main__":
    asyncio.run(main())
