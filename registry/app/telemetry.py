import logging
import threading
import time
import uuid
from contextvars import ContextVar
from typing import Any

request_id_var: ContextVar[str] = ContextVar("request_id", default="-")

LOGGER_NAME = "openagenthub.registry"


class RequestIdFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        record.request_id = request_id_var.get()
        return True


_configured = False


def configure_logging() -> None:
    global _configured
    if _configured:
        return
    logger = logging.getLogger(LOGGER_NAME)
    if logger.handlers:
        return
    handler = logging.StreamHandler()
    handler.addFilter(RequestIdFilter())
    logger.addHandler(handler)
    logger.setLevel(logging.INFO)
    _configured = True


def get_logger(name: str = "") -> logging.Logger:
    configure_logging()
    return logging.getLogger(LOGGER_NAME + (f".{name}" if name else ""))


class Metrics:
    def __init__(self) -> None:
        self._counters: dict[tuple[str, tuple[tuple[str, str], ...]], int] = {}
        self._lock = threading.Lock()

    def incr(self, name: str, **labels: Any) -> None:
        self.add(name, 1, **labels)

    def add(self, name: str, value: int, **labels: Any) -> None:
        key = (name, tuple(sorted(labels.items())))
        with self._lock:
            self._counters[key] = self._counters.get(key, 0) + value

    def render(self) -> str:
        with self._lock:
            items = sorted(self._counters.items())
        lines = []
        for (name, labels), value in items:
            if labels:
                label_str = ",".join(f'{k}="{v}"' for k, v in labels)
                lines.append(f"{name}{{{label_str}}} {value}")
            else:
                lines.append(f"{name} {value}")
        return "\n".join(lines) + "\n"

    def reset(self) -> None:
        with self._lock:
            self._counters.clear()


metrics = Metrics()


def new_request_id() -> str:
    return uuid.uuid4().hex[:16]


async def request_metrics_middleware(request, call_next):
    request_id = request.headers.get("x-request-id") or new_request_id()
    token = request_id_var.set(request_id)
    started = time.monotonic()
    status = "error"
    try:
        response = await call_next(request)
        status = str(response.status_code)
        response.headers["X-Request-Id"] = request_id
        return response
    finally:
        request_id_var.reset(token)
        elapsed_ms = int((time.monotonic() - started) * 1000)
        metrics.incr("http_requests_total", method=request.method, path=request.url.path, status=status)
        metrics.add("http_request_duration_ms_total", elapsed_ms, method=request.method, path=request.url.path)
