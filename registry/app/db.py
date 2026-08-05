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
