from collections.abc import AsyncIterator

from sqlalchemy import JSON, Text, event
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.engine import Engine
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy.types import TypeDecorator
from datetime import datetime, timezone

from app.config import get_settings


class Base(DeclarativeBase):
    pass


class JSONType(TypeDecorator):
    """JSON that maps to JSONB on Postgres and JSON/Text on SQLite."""

    impl = Text
    cache_ok = True

    def load_dialect_impl(self, dialect):
        if dialect.name == "postgresql":
            return dialect.type_descriptor(JSONB())
        return dialect.type_descriptor(JSON())


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


@event.listens_for(Engine, "connect")
def _set_sqlite_pragma(dbapi_connection, _record) -> None:
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()


def create_engine_and_session(url: str | None = None):
    url = url or get_settings().database_url
    engine = create_async_engine(url, echo=False)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    return engine, session_factory


_engine, _session_factory = create_engine_and_session()


def get_session_factory() -> async_sessionmaker[AsyncSession]:
    return _session_factory


async def get_session() -> AsyncIterator[AsyncSession]:
    async with _session_factory() as session:
        yield session


async def init_db() -> None:
    async with _engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    await _ensure_latest_version_columns()


async def _ensure_latest_version_columns() -> None:
    """Add and backfill ``agent_versions.sort_key`` on pre-existing databases.

    ``create_all`` only creates tables that do not exist; a database created
    before M-6 needs the sort key added (and recomputed) for SQL-side
    latest-version selection. Both SQLite and PostgreSQL support ADD COLUMN.
    """
    from sqlalchemy import text

    from app.registry.semver import sort_key

    async with _engine.begin() as conn:
        try:
            await conn.execute(text("ALTER TABLE agent_versions ADD COLUMN sort_key VARCHAR(128)"))
        except Exception:  # noqa: BLE001 — column already present
            pass
        rows = (await conn.execute(text("SELECT id, version FROM agent_versions WHERE sort_key IS NULL OR sort_key = ''"))).fetchall()
        for version_id, version in rows:
            await conn.execute(
                text("UPDATE agent_versions SET sort_key = :key WHERE id = :id"),
                {"key": sort_key(version), "id": version_id},
            )


async def reset_db() -> None:
    """Drop and recreate all tables (test/scratch use)."""
    async with _engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)


async def dispose_db() -> None:
    await _engine.dispose()


async def ping_db() -> bool:
    from sqlalchemy import text

    async with _engine.connect() as conn:
        await conn.execute(text("SELECT 1"))
    return True
