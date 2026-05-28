"""Dual-database connection layer.

Provides lazy-initialized engines that are NOT created at import time:
- Async SQLAlchemy engine + session factory for PostgreSQL (asyncpg).
- Sync SQLAlchemy engine for MySQL (PyMySQL, read-only).

Both engines are global singletons; disposal is explicit via `dispose_engines()`
to support FastAPI lifespan clean shutdown.
"""

from sqlalchemy import create_engine
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.config import settings

# Lazy singletons — NOT initialized at import time.
_async_engine = None
_async_session_factory: async_sessionmaker[AsyncSession] | None = None
_sync_engine = None


def get_async_engine():
    """Return the async PostgreSQL engine, creating it on first call."""
    global _async_engine
    if _async_engine is None:
        _async_engine = create_async_engine(
            settings.indicadores_database_url,
            echo=False,
            pool_size=5,
            max_overflow=10,
            pool_pre_ping=True,
        )
    return _async_engine


def get_async_session_factory() -> async_sessionmaker[AsyncSession]:
    """Return the async session factory, creating it on first call."""
    global _async_session_factory
    if _async_session_factory is None:
        _async_session_factory = async_sessionmaker(
            get_async_engine(),
            class_=AsyncSession,
            expire_on_commit=False,
        )
    return _async_session_factory


def get_sync_engine():
    """Return the sync MySQL (OpenMRS) engine, creating it on first call.

    This engine is for READ-ONLY queries against the external OpenMRS database.
    Never use it for writes.
    """
    global _sync_engine
    if _sync_engine is None:
        _sync_engine = create_engine(
            settings.openmrs_database_url,
            echo=False,
            pool_pre_ping=True,
        )
    return _sync_engine


async def dispose_engines():
    """Dispose all engines and reset globals — used in FastAPI lifespan shutdown."""
    global _async_engine, _async_session_factory, _sync_engine
    if _async_engine is not None:
        await _async_engine.dispose()
        _async_engine = None
        _async_session_factory = None
    if _sync_engine is not None:
        _sync_engine.dispose()
        _sync_engine = None
