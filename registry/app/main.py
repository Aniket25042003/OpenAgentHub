from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, PlainTextResponse

from app.config import get_settings
from app.db import dispose_db, init_db, ping_db
from app.identity.routes import router as identity_router
from app.outbox.dispatcher import OutboxDispatcher
from app.ratelimit import RateLimitExceeded
from app.registry.downloads import get_download_buffer
from app.registry.routes import router as registry_router
from app.telemetry import configure_logging, get_logger, metrics, request_metrics_middleware

log = get_logger("main")


@asynccontextmanager
async def lifespan(app: FastAPI):
    configure_logging()
    await init_db()
    dispatcher = OutboxDispatcher(poll_interval=get_settings().outbox_poll_interval_seconds)
    dispatcher.start()
    app.state.dispatcher = dispatcher
    settings = get_settings()
    buffer = get_download_buffer(interval_seconds=settings.download_flush_seconds)
    buffer.start()
    app.state.download_buffer = buffer
    log.info("registry started with outbox dispatcher and download buffer")
    yield
    await buffer.stop(flush=True)
    await dispatcher.stop()
    await dispose_db()


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title="OpenAgentHub Registry", version="0.1.0", lifespan=lifespan)
    app.middleware("http")(request_metrics_middleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(identity_router)
    app.include_router(registry_router)

    @app.exception_handler(RateLimitExceeded)
    async def rate_limit_handler(request: Request, exc: RateLimitExceeded):
        headers = {"Retry-After": str(exc.retry_after)}
        if exc.limit is not None:
            headers["X-RateLimit-Limit"] = str(exc.limit)
        if exc.window_seconds is not None:
            headers["X-RateLimit-Window"] = str(exc.window_seconds)
        return JSONResponse(status_code=429, content={"detail": str(exc)}, headers=headers)

    @app.get("/health")
    async def health():
        return {"status": "ok"}

    @app.get("/ready")
    async def readiness():
        checks: dict[str, str] = {}
        ready = True
        try:
            await ping_db()
            checks["database"] = "ok"
        except Exception:  # noqa: BLE001
            checks["database"] = "error"
            ready = False
        storage = Path(settings.storage_dir)
        try:
            storage.mkdir(parents=True, exist_ok=True)
            checks["storage"] = "ok" if storage.is_dir() else "error"
        except OSError:
            checks["storage"] = "error"
            ready = False
        if not ready:
            return JSONResponse(status_code=503, content={"status": "not_ready", "checks": checks})
        return {"status": "ready", "checks": checks}

    @app.get("/metrics")
    async def metrics_endpoint():
        return PlainTextResponse(metrics.render(), media_type="text/plain; version=0.0.4")

    return app


app = create_app()
