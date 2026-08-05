import base64
import io
import tarfile

from sqlalchemy import select

from app.db import get_session_factory
from app.outbox.dispatcher import OutboxDispatcher
from app.outbox.models import OutboxEvent, QueueJob
from app.outbox.queue import DurableQueue
from app.outbox.worker import JobWorker
from app.workers.scan import ScanWorker
from tests.factories import create_user, publish, signed_package
from tests.helpers import hello_manifest, make_keypair, sha256_hex, signature_payload


async def test_publish_enqueues_scan_event(client):
    token, _ = await create_user()
    archive, sig, _, _ = signed_package("acme", "queued", "1.0.0")
    res = await publish(client, token, "acme", "queued", "1.0.0", archive, sig)
    assert res.status_code == 200, res.text
    async with get_session_factory()() as session:
        events = (
            await session.execute(select(OutboxEvent).where(OutboxEvent.event_type == "scan.requested"))
        ).scalars().all()
        assert len(events) == 1
        assert events[0].payload["name"] == "queued"
        assert events[0].published_at is None


async def test_dispatcher_publishes_event_to_queue(client):
    token, _ = await create_user()
    archive, sig, _, _ = signed_package("acme", "dispatch", "1.0.0")
    await publish(client, token, "acme", "dispatch", "1.0.0", archive, sig)

    dispatcher = OutboxDispatcher(poll_interval=0.01)
    published = await dispatcher.dispatch_once()
    assert published == 1

    async with get_session_factory()() as session:
        events = (await session.execute(select(OutboxEvent))).scalars().all()
        assert all(e.published_at is not None for e in events)
        jobs = (await session.execute(select(QueueJob))).scalars().all()
        assert len(jobs) == 1
        assert jobs[0].job_type == "scan.run"
        assert jobs[0].status == "queued"

    assert await dispatcher.dispatch_once() == 0


async def test_dispatcher_idempotent_across_crash(client):
    token, _ = await create_user()
    archive, sig, _, _ = signed_package("acme", "crashy", "1.0.0")
    await publish(client, token, "acme", "crashy", "1.0.0", archive, sig)

    dispatcher = OutboxDispatcher(poll_interval=0.01)
    await dispatcher.dispatch_once()
    # simulate crash after enqueue but before marking the event published:
    async with get_session_factory()() as session:
        event = (await session.execute(select(OutboxEvent))).scalars().first()
        event.published_at = None
        await session.commit()
    await dispatcher.dispatch_once()
    async with get_session_factory()() as session:
        jobs = (await session.execute(select(QueueJob))).scalars().all()
        assert len(jobs) == 1, "duplicate delivery must be deduplicated"


async def test_scan_worker_processes_job_idempotently(client):
    token, _ = await create_user()
    archive, sig, _, _ = signed_package("acme", "worker", "1.0.0")
    await publish(client, token, "acme", "worker", "1.0.0", archive, sig)

    await OutboxDispatcher(poll_interval=0.01).dispatch_once()

    worker = ScanWorker()
    assert await worker.run_once() == 1
    assert await worker.run_once() == 0, "already succeeded job must not be re-claimed"

    res = await client.get("/api/v1/agents/acme/worker/versions/1.0.0")
    assert res.json()["security"]["status"] == "clean"


async def test_scan_worker_flags_hostile_archive(client):
    token, _ = await create_user()
    key, priv, pub = make_keypair()
    full = "acme/hostile"
    manifest = hello_manifest(full, "1.0.0")
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tf:
        data = yaml_dump(manifest).encode()
        info = tarfile.TarInfo("agent.yaml")
        info.size = len(data)
        info.mode = 0o644
        tf.addfile(info, io.BytesIO(data))
        link = tarfile.TarInfo("evil")
        link.type = tarfile.SYMTYPE
        link.linkname = "/etc/passwd"
        tf.addfile(link)
    archive = buf.getvalue()
    sha = sha256_hex(archive)
    sig = {
        "schemaVersion": 1,
        "name": full,
        "version": "1.0.0",
        "algorithm": "ed25519",
        "publicKey": pub,
        "publicKeyId": "",
        "sha256": sha,
        "signature": base64.b64encode(key.sign(signature_payload(full, "1.0.0", sha).encode())).decode(),
    }
    assert (await publish(client, token, "acme", "hostile", "1.0.0", archive, sig)).status_code == 200

    await OutboxDispatcher(poll_interval=0.01).dispatch_once()
    assert await ScanWorker().run_once() == 1
    res = await client.get("/api/v1/agents/acme/hostile/versions/1.0.0")
    body = res.json()
    assert body["security"]["status"] == "flagged"
    assert any("symlink" in f for f in body["security"]["findings"])


class FlakyWorker(JobWorker):
    job_type = "flaky.run"

    def __init__(self, fail_times: int, **kw):
        super().__init__(**kw)
        self.fail_times = fail_times

    async def handle(self, session, payload: dict) -> None:
        if self.fail_times > 0:
            self.fail_times -= 1
            raise RuntimeError("boom")


async def _enqueue_flaky(queue: DurableQueue, key: str) -> None:
    async with get_session_factory()() as session:
        await queue.enqueue(session, "flaky.run", {"n": 1}, dedupe_key=key)
        await session.commit()


async def _flaky_job(key: str) -> QueueJob:
    async with get_session_factory()() as session:
        return (await session.execute(select(QueueJob).where(QueueJob.dedupe_key == key))).scalar_one()


async def test_retry_then_success():
    queue = DurableQueue(max_attempts=3, backoff_base_seconds=0.0)
    await _enqueue_flaky(queue, "flaky:1")
    worker = FlakyWorker(fail_times=1, queue=queue)
    assert await worker.run_once() == 1  # fails, requeued with backoff
    assert await worker.run_once() == 1  # succeeds
    assert await worker.run_once() == 0
    job = await _flaky_job("flaky:1")
    assert job.status == "succeeded"
    assert job.attempts == 2
    assert job.last_error is None


async def test_dead_letter_after_max_attempts():
    queue = DurableQueue(max_attempts=3, backoff_base_seconds=0.0)
    await _enqueue_flaky(queue, "flaky:2")
    worker = FlakyWorker(fail_times=99, queue=queue)
    for _ in range(3):
        assert await worker.run_once() == 1
    assert await worker.run_once() == 0
    job = await _flaky_job("flaky:2")
    assert job.status == "dead"
    assert job.attempts == 3
    assert "boom" in job.last_error
    # dead jobs can be re-enqueued with the same key:
    async with get_session_factory()() as session:
        assert await queue.enqueue(session, "flaky.run", {"n": 2}, dedupe_key="flaky:2") is True
        await session.commit()


async def test_stale_lease_is_requeued():
    queue = DurableQueue(lease_seconds=60)
    await _enqueue_flaky(queue, "flaky:3")
    async with get_session_factory()() as session:
        claimed = await queue.claim(session, "flaky.run", "crashed-worker")
        assert claimed is not None
        await session.commit()
    job = await _flaky_job("flaky:3")
    assert job.status == "running"
    assert job.lease_owner == "crashed-worker"
    # lease has not expired yet: worker must not claim it
    worker = FlakyWorker(fail_times=0, queue=queue)
    assert await worker.run_once() == 0
    # simulate the crashed worker's lease expiring, then the sweep requeues it
    from app.db import utcnow

    from datetime import timedelta

    async with get_session_factory()() as session:
        stale = await session.get(QueueJob, job.id)
        stale.leased_until = utcnow() - timedelta(seconds=1)
        await session.commit()
    from app.workers.maintenance import MaintenanceWorker

    assert await MaintenanceWorker(queue=queue).run_once() == 0
    job = await _flaky_job("flaky:3")
    assert job.status == "queued"
    assert await worker.run_once() == 1
    assert (await _flaky_job("flaky:3")).status == "succeeded"


def yaml_dump(obj):
    import yaml

    return yaml.safe_dump(obj)
