"""Query executor — runs MySQL read-only queries and persists results to PostgreSQL.

This module is the bridge between the SQL builder and the database layer.
It executes parameterized queries against the OpenMRS MySQL database and
stores calculated results (IndicadorResultado rows) in the local PostgreSQL
indicators database.
"""

import uuid
from datetime import date, datetime, timezone

from sqlalchemy import text

from app.database import get_async_session_factory, get_sync_engine
from app.models.indicador import IndicadorResultado


def execute_and_persist(
    query_sql: str,
    params: dict,
    indicador_version_id: uuid.UUID,
    periodo_inicio: date,
    periodo_fin: date,
) -> list[IndicadorResultado]:
    """Execute a read-only MySQL query and persist each result row to PostgreSQL.

    Args:
        query_sql: Parameterized SQL string (uses %(name)s syntax for PyMySQL).
        params: Parameter values keyed by name.
        indicador_version_id: Which IndicadorVersion these results belong to.
        periodo_inicio: Start date of the calculation period.
        periodo_fin: End date of the calculation period.

    Returns:
        The list of persisted IndicadorResultado ORM instances.

    Raises:
        Exception: If MySQL query fails or PostgreSQL persistence fails.
            No partial data is committed — either all results persist or none.
    """
    sync_engine = get_sync_engine()

    # ── 1. Execute on MySQL (read-only) ──
    with sync_engine.connect() as conn:
        result = conn.execute(text(query_sql), params)
        rows = result.fetchall()

    # ── 2. Build ORM instances ──
    now = datetime.now(timezone.utc)
    resultados = []
    for row in rows:
        valor = float(row.valor)  # MySQL Decimal → Python float
        resultados.append(
            IndicadorResultado(
                id=uuid.uuid4(),
                indicador_version_id=indicador_version_id,
                periodo_inicio=periodo_inicio,
                periodo_fin=periodo_fin,
                valor=valor,
                calculado_en=now,
            )
        )

    # ── 3. Persist to PostgreSQL ──
    if resultados:
        _persist_resultados(resultados)

    return resultados


async def execute_and_persist_async(
    query_sql: str,
    params: dict,
    indicador_version_id: uuid.UUID,
    periodo_inicio: date,
    periodo_fin: date,
) -> list[IndicadorResultado]:
    """Async version — for use within FastAPI route handlers.

    The MySQL query is still sync (PyMySQL), but PostgreSQL persistence
    uses the async session. This avoids blocking the event loop during
    the PG write phase.
    """
    sync_engine = get_sync_engine()

    # ── 1. Execute on MySQL (read-only, sync) ──
    with sync_engine.connect() as conn:
        result = conn.execute(text(query_sql), params)
        rows = result.fetchall()

    # ── 2. Build ORM instances ──
    now = datetime.now(timezone.utc)
    resultados = []
    for row in rows:
        valor = float(row.valor)
        resultados.append(
            IndicadorResultado(
                id=uuid.uuid4(),
                indicador_version_id=indicador_version_id,
                periodo_inicio=periodo_inicio,
                periodo_fin=periodo_fin,
                valor=valor,
                calculado_en=now,
            )
        )

    # ── 3. Persist to PostgreSQL (async) ──
    if resultados:
        await _persist_resultados_async(resultados)

    return resultados


def _persist_resultados(resultados: list[IndicadorResultado]) -> None:
    """Synchronous persistence helper."""
    # For sync usage, we need a sync PG session.
    # Since our main PG engine is async-only, we import and create a sync
    # session from the sync URL for this purpose.
    from sqlalchemy import create_engine
    from sqlalchemy.orm import Session

    from app.config import settings

    sync_url = settings.indicadores_database_sync_url
    engine = create_engine(sync_url, echo=False)
    with Session(engine) as session:
        session.add_all(resultados)
        session.commit()
    engine.dispose()


async def _persist_resultados_async(
    resultados: list[IndicadorResultado],
) -> None:
    """Async persistence helper using the async session factory."""
    factory = get_async_session_factory()
    async with factory() as session:
        session.add_all(resultados)
        await session.commit()
