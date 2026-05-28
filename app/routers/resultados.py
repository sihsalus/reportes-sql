"""Resultados router — query and trigger indicator calculations.

Task 4.3:
- GET  /resultados?indicador_id=X&periodo_inicio=...&periodo_fin=...
       → filterable, paginated list of pre-computed results.
- POST /resultados/calcular-ahora
       → iterate all active indicators, compute their periodo dates,
         run engine/interpreter + executor, return batch summary.
"""

import uuid
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_async_session_factory
from app.engine.periodo import calcular_periodo
from app.models.indicador import Indicador, IndicadorResultado, IndicadorVersion
from app.schemas.indicador import (
    BatchCalcularNowResponse,
    ErrorCalculo,
    IndicadorResultadoEnrichedResponse,
    ResultadoListResponse,
)

router = APIRouter()


# ── Dependency ─────────────────────────────────────────────────────────


async def get_db():
    """Yield an async database session from the global factory."""
    factory = get_async_session_factory()
    async with factory() as session:
        yield session


# ── GET filterable results ─────────────────────────────────────────────


@router.get(
    "/",
    response_model=ResultadoListResponse,
    summary="Query pre-computed indicator results",
)
async def get_resultados(
    indicador_id: uuid.UUID | None = Query(
        None, description="Filter by indicator (joins through IndicadorVersion)"
    ),
    periodo_inicio: date | None = Query(
        None, description="Filter results with period_start >= this date"
    ),
    periodo_fin: date | None = Query(
        None, description="Filter results with period_end <= this date"
    ),
    page: int = Query(1, ge=1, description="Page number (1-indexed)"),
    size: int = Query(20, ge=1, le=100, description="Items per page"),
    db: AsyncSession = Depends(get_db),
):
    """Return a filterable, paginated list of computed IndicadorResultado rows.

    When indicador_id is provided, results are scoped to that indicator
    (joined through IndicadorVersion). Date filters apply to period boundaries.
    """
    # Build base query with eager-loading for relationships
    base = select(IndicadorResultado).options(
        selectinload(IndicadorResultado.indicador_version).selectinload(
            IndicadorVersion.indicador
        )
    )

    if indicador_id is not None:
        base = base.join(IndicadorVersion).where(
            IndicadorVersion.indicador_id == indicador_id
        )
    if periodo_inicio is not None:
        base = base.where(IndicadorResultado.periodo_inicio >= periodo_inicio)
    if periodo_fin is not None:
        base = base.where(IndicadorResultado.periodo_fin <= periodo_fin)

    # Count with identical filters (no selectinload needed)
    count_from = IndicadorResultado
    count_query = select(func.count()).select_from(count_from)
    if indicador_id is not None:
        count_query = count_query.join(IndicadorVersion).where(
            IndicadorVersion.indicador_id == indicador_id
        )
    if periodo_inicio is not None:
        count_query = count_query.where(
            IndicadorResultado.periodo_inicio >= periodo_inicio
        )
    if periodo_fin is not None:
        count_query = count_query.where(
            IndicadorResultado.periodo_fin <= periodo_fin
        )

    total: int = (await db.execute(count_query)).scalar() or 0
    pages: int = max(1, (total + size - 1) // size)

    # Fetch page
    result = await db.execute(
        base.order_by(IndicadorResultado.calculado_en.desc())
        .offset((page - 1) * size)
        .limit(size)
    )
    rows = result.scalars().all()

    items = [
        IndicadorResultadoEnrichedResponse(
            id=r.id,
            indicador_version_id=r.indicador_version_id,
            periodo_inicio=r.periodo_inicio,
            periodo_fin=r.periodo_fin,
            valor=float(r.valor),
            calculado_en=r.calculado_en,
            indicador_nombre=r.indicador_version.indicador.nombre,
            indicador_version_num=r.indicador_version.version,
        )
        for r in rows
    ]

    return ResultadoListResponse(
        items=items,
        total=total,
        page=page,
        size=size,
        pages=pages,
    )


# ── POST batch calculation ─────────────────────────────────────────────


@router.post(
    "/calcular-ahora",
    response_model=BatchCalcularNowResponse,
    summary="Calculate all active indicators now",
)
async def calcular_ahora(
    db: AsyncSession = Depends(get_db),
):
    """Iterate every active indicator and compute its result for its configured period.

    For each active indicator:
    1. Retrieve its latest IndicadorVersion.
    2. Parse the definicion into DefinicionIndicador (Pydantic).
    3. Calculate periodo dates from definicion.periodo.
    4. Build the parameterized MySQL query via engine/interpreter.py.
    5. Execute against OpenMRS MySQL and persist results via engine/executor.py.

    Individual indicator failures are caught and reported in `errores` —
    they never abort the batch.
    """
    # Fetch all active indicators
    result = await db.execute(
        select(Indicador).where(Indicador.activo.is_(True))
    )
    indicadores = result.scalars().all()

    calculados = 0
    errores: list[ErrorCalculo] = []
    total = len(indicadores)

    for indicador in indicadores:
        try:
            # Get latest version
            version_result = await db.execute(
                select(IndicadorVersion)
                .where(IndicadorVersion.indicador_id == indicador.id)
                .order_by(IndicadorVersion.version.desc())
                .limit(1)
            )
            latest = version_result.scalar_one_or_none()
            if latest is None:
                errores.append(
                    ErrorCalculo(
                        indicador_id=indicador.id,
                        indicador_nombre=indicador.nombre,
                        error="Sin versiones definidas",
                    )
                )
                continue

            # Parse definicion and compute period
            from app.types.definicion import DefinicionIndicador

            definicion = DefinicionIndicador.model_validate(latest.definicion)
            periodo_inicio, periodo_fin = calcular_periodo(definicion.periodo)

            # ── Resolve ordenes concept UUIDs to OpenMRS concept_ids ──
            concept_map: dict[str, int] | None = None
            ordenes = definicion.evento.ordenes if definicion.evento else None
            if ordenes:
                from app.database import get_sync_engine

                sync_engine = get_sync_engine()
                uuids = [str(f.concepto_uuid) for f in ordenes]
                with sync_engine.connect() as conn:
                    from sqlalchemy import text

                    result_rows = conn.execute(
                        text(
                            "SELECT uuid, concept_id FROM concept "
                            "WHERE uuid IN :uuids AND retired = 0"
                        ),
                        {"uuids": tuple(uuids)},
                    ).fetchall()

                resolved: dict[str, int] = {
                    row.uuid: row.concept_id for row in result_rows
                }

                missing: list[str] = []
                concept_map = {}
                for f in ordenes:
                    suuid = str(f.concepto_uuid)
                    cid = resolved.get(suuid)
                    if cid is None:
                        missing.append(suuid)
                    else:
                        concept_map[f.concepto_uuid] = cid

                if missing:
                    raise HTTPException(
                        status_code=502,
                        detail={
                            "field": "ordenes",
                            "reason": "CONCEPT_NOT_FOUND",
                            "missing": missing,
                        },
                    )

            # Build query and execute
            from app.engine.executor import execute_and_persist_async
            from app.engine.interpreter import build_query

            query_sql, params = build_query(
                definicion, periodo_inicio, periodo_fin, concept_map=concept_map
            )
            await execute_and_persist_async(
                query_sql, params, latest.id, periodo_inicio, periodo_fin
            )

            calculados += 1

        except Exception as exc:
            errores.append(
                ErrorCalculo(
                    indicador_id=indicador.id,
                    indicador_nombre=indicador.nombre,
                    error=str(exc),
                )
            )

    return BatchCalcularNowResponse(
        calculados=calculados,
        errores=errores,
        total=total,
    )
