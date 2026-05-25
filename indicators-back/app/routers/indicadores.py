"""Indicador CRUD router — FastAPI endpoints for indicator lifecycle.

Tasks 4.1 (CRUD) and 4.2 (versioning):
- POST   /indicadores                   → create Indicador + version 1
- GET    /indicadores                   → list active indicators (paginated)
- GET    /indicadores/{id}              → detail with all versions
- DELETE /indicadores/{id}              → soft-delete (activo=false)
- POST   /indicadores/{id}/versiones    → create new immutable version
"""

import json
import uuid
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_async_session_factory, get_sync_engine
from app.engine.periodo import calcular_periodo
from app.models.indicador import Indicador, IndicadorVersion
from app.schemas.indicador import (
    IndicadorCreate,
    IndicadorDetailResponse,
    IndicadorListResponse,
    IndicadorResponse,
    IndicadorSQLPreviewResponse,
    IndicadorUpdate,
    IndicadorVersionCreate,
    IndicadorVersionResponse,
)
from app.types.definicion import DefinicionIndicador
from app.validators.openmrs import validar_definicion_location_uuids

router = APIRouter()


# ── Dependency ─────────────────────────────────────────────────────────


async def get_db():
    """Yield an async database session from the global factory."""
    factory = get_async_session_factory()
    async with factory() as session:
        yield session


# ── CRUD Endpoints ─────────────────────────────────────────────────────


@router.post(
    "/",
    response_model=IndicadorResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a new indicator",
)
async def create_indicador(
    body: IndicadorCreate,
    db: AsyncSession = Depends(get_db),
):
    """Create an Indicador together with its first IndicadorVersion (version=1).

    The definicion field is validated as DefinicionIndicador and stored as JSONB
    in the new version row. Both rows are committed atomically.
    """
    # Validate location_uuids exist in OpenMRS before DB write.
    # Raises 422 (unknown UUIDs) or 502 (OpenMRS unavailable).
    validar_definicion_location_uuids(body.definicion)

    indicador = Indicador(
        nombre=body.nombre,
        descripcion=body.descripcion,
    )
    db.add(indicador)
    await db.flush()  # Populate indicador.id

    version = IndicadorVersion(
        indicador_id=indicador.id,
        version=1,
        definicion=body.definicion.model_dump(),
    )
    db.add(version)
    await db.commit()
    await db.refresh(indicador)

    return indicador


@router.get(
    "/",
    response_model=IndicadorListResponse,
    summary="List active indicators",
)
async def list_indicadores(
    page: int = Query(1, ge=1, description="Page number (1-indexed)"),
    size: int = Query(20, ge=1, le=100, description="Items per page"),
    db: AsyncSession = Depends(get_db),
):
    """Return a paginated list of active indicators.

    Only indicators with activo=True are included. Results are ordered by
    creation date (newest first).
    """
    # Count active indicators
    count_result = await db.execute(
        select(func.count()).select_from(Indicador).where(Indicador.activo.is_(True))
    )
    total: int = count_result.scalar() or 0
    pages: int = max(1, (total + size - 1) // size)

    # Fetch page
    result = await db.execute(
        select(Indicador)
        .where(Indicador.activo.is_(True))
        .order_by(Indicador.creado_en.desc())
        .offset((page - 1) * size)
        .limit(size)
    )
    items = result.scalars().all()

    return IndicadorListResponse(
        items=items,
        total=total,
        page=page,
        size=size,
        pages=pages,
    )


@router.get(
    "/{indicador_id}",
    response_model=IndicadorDetailResponse,
    summary="Get indicator detail with all versions",
)
async def get_indicador(
    indicador_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    """Return an indicator with its full version history (newest first).

    Raises 404 if the indicator does not exist.
    """
    result = await db.execute(
        select(Indicador).where(Indicador.id == indicador_id)
    )
    indicador = result.scalar_one_or_none()
    if indicador is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Indicador no encontrado",
        )

    # Fetch versions separately to control ordering
    versions_result = await db.execute(
        select(IndicadorVersion)
        .where(IndicadorVersion.indicador_id == indicador_id)
        .order_by(IndicadorVersion.version.desc())
    )
    versiones = versions_result.scalars().all()

    return IndicadorDetailResponse(
        id=indicador.id,
        nombre=indicador.nombre,
        descripcion=indicador.descripcion,
        activo=indicador.activo,
        creado_en=indicador.creado_en,
        versiones=versiones,
    )


@router.put(
    "/{indicador_id}",
    response_model=IndicadorResponse,
    summary="Update indicator metadata (and optionally auto-create a new version)",
)
async def update_indicador(
    indicador_id: uuid.UUID,
    body: IndicadorUpdate,
    db: AsyncSession = Depends(get_db),
):
    """Update an indicator's nombre and descripcion.

    When ``definicion`` is present and semantically differs from the latest
    version (order-insensitive JSON comparison), the endpoint validates
    encounter UUIDs against OpenMRS and auto-creates a new IndicadorVersion.

    Returns 200 with the updated indicator; 404 if not found;
    422 if definicion is invalid or encounter UUIDs are unknown;
    502 if OpenMRS is unreachable.
    """
    result = await db.execute(
        select(Indicador).where(Indicador.id == indicador_id)
    )
    indicador = result.scalar_one_or_none()
    if indicador is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Indicador no encontrado",
        )

    # ── Auto-versioning when definicion is present ──────────────────
    if body.definicion is not None:
        # Fetch the latest version for comparison
        latest_result = await db.execute(
            select(IndicadorVersion)
            .where(IndicadorVersion.indicador_id == indicador_id)
            .order_by(IndicadorVersion.version.desc())
            .limit(1)
        )
        latest_version = latest_result.scalar_one_or_none()

        # Normalize both for order-insensitive comparison.
        # Re-parse the stored dict through Pydantic so both sides produce
        # the exact same shape (same keys, same defaults).
        incoming = json.dumps(
            body.definicion.model_dump(), sort_keys=True, default=str
        )
        existing = (
            json.dumps(
                DefinicionIndicador.model_validate(
                    latest_version.definicion
                ).model_dump(),
                sort_keys=True,
                default=str,
            )
            if latest_version is not None
            else None
        )

        if incoming != existing:
            # Validate location UUIDs against OpenMRS
            validar_definicion_location_uuids(body.definicion)

            # Compute next version number
            max_result = await db.execute(
                select(func.max(IndicadorVersion.version)).where(
                    IndicadorVersion.indicador_id == indicador_id
                )
            )
            max_version: int = max_result.scalar() or 0

            nueva_version = IndicadorVersion(
                indicador_id=indicador_id,
                version=max_version + 1,
                definicion=body.definicion.model_dump(),
            )
            db.add(nueva_version)

    # ── Always update metadata ─────────────────────────────────────
    indicador.nombre = body.nombre
    indicador.descripcion = body.descripcion
    await db.commit()
    await db.refresh(indicador)
    return indicador


@router.delete(
    "/{indicador_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Soft-delete an indicator",
)
async def delete_indicador(
    indicador_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    """Soft-delete: sets activo=False. Historical data is preserved.

    Raises 404 if the indicator does not exist.
    """
    result = await db.execute(
        select(Indicador).where(Indicador.id == indicador_id)
    )
    indicador = result.scalar_one_or_none()
    if indicador is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Indicador no encontrado",
        )
    indicador.activo = False
    await db.commit()
    return None  # 204 No Content


# ── Versioning ──────────────────────────────────────────────────────────


@router.post(
    "/{indicador_id}/versiones",
    response_model=IndicadorVersionResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a new immutable version",
)
async def create_version(
    indicador_id: uuid.UUID,
    body: IndicadorVersionCreate,
    db: AsyncSession = Depends(get_db),
):
    """Auto-increment version number and create a new IndicadorVersion.

    Previous versions are NEVER modified (immutable rule). The version number
    is computed as MAX(existing_versions) + 1. A UNIQUE(indicador_id, version)
    constraint in the database catches race conditions — if two concurrent
    requests attempt the same version number, the second gets a 409 Conflict.
    """
    # Validate location_uuids exist in OpenMRS before DB write.
    # Raises 422 (unknown UUIDs) or 502 (OpenMRS unavailable).
    validar_definicion_location_uuids(body.definicion)

    # Verify the indicator exists
    result = await db.execute(
        select(Indicador).where(Indicador.id == indicador_id)
    )
    indicador = result.scalar_one_or_none()
    if indicador is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Indicador no encontrado",
        )

    # Compute next version number
    max_version_result = await db.execute(
        select(func.max(IndicadorVersion.version)).where(
            IndicadorVersion.indicador_id == indicador_id
        )
    )
    max_version: int = max_version_result.scalar() or 0

    nueva_version = IndicadorVersion(
        indicador_id=indicador_id,
        version=max_version + 1,
        definicion=body.definicion.model_dump(),
    )
    db.add(nueva_version)

    try:
        await db.commit()
        await db.refresh(nueva_version)
    except IntegrityError:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Conflicto de versión — otro proceso creó la misma versión. Intente nuevamente.",
        )

    return nueva_version


# ── SQL Preview ─────────────────────────────────────────────────────────


@router.get(
    "/{indicador_id}/preview-sql",
    response_model=IndicadorSQLPreviewResponse,
    summary="Preview the generated SQL for an indicator version",
)
async def preview_sql(
    indicador_id: uuid.UUID,
    version_id: uuid.UUID | None = Query(
        None, description="Specific version UUID. Defaults to the latest version."
    ),
    db: AsyncSession = Depends(get_db),
):
    """Generate a preview of the SQL query for an indicator version.

    Computes the period dates from the definition's periodo field, builds
    the parameterized MySQL query via the engine, and returns the SQL string
    alongside the resolved parameters — without connecting to OpenMRS.
    """
    # ── Fetch indicator ──
    result = await db.execute(
        select(Indicador).where(Indicador.id == indicador_id)
    )
    indicador = result.scalar_one_or_none()
    if indicador is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Indicador no encontrado",
        )

    # ── Fetch version (specific or latest) ──
    if version_id is not None:
        version_result = await db.execute(
            select(IndicadorVersion)
            .where(
                IndicadorVersion.id == version_id,
                IndicadorVersion.indicador_id == indicador_id,
            )
        )
        version = version_result.scalar_one_or_none()
        if version is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Versión no encontrada para este indicador",
            )
    else:
        version_result = await db.execute(
            select(IndicadorVersion)
            .where(IndicadorVersion.indicador_id == indicador_id)
            .order_by(IndicadorVersion.version.desc())
            .limit(1)
        )
        version = version_result.scalar_one_or_none()
        if version is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="El indicador no tiene versiones definidas",
            )

    # ── Parse definicion and compute period ──
    from app.engine.interpreter import build_query

    definicion = DefinicionIndicador.model_validate(version.definicion)
    periodo_inicio, periodo_fin = calcular_periodo(definicion.periodo)

    # ── Resolve concept_map for ordenes if present ──
    concept_map: dict[str, int] | None = None
    ordenes = definicion.evento.ordenes if definicion.evento else None
    if ordenes:
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

        concept_map = {}
        for f in ordenes:
            suuid = str(f.concepto_uuid)
            cid = resolved.get(suuid)
            if cid is None:
                continue  # Skip unresolved — query may still be valid
            concept_map[f.concepto_uuid] = cid

    # ── Build query ──
    query_sql, params = build_query(
        definicion, periodo_inicio, periodo_fin, concept_map=concept_map
    )

    # ── Serialize params for JSON (dates → string) ──
    serializable_params: dict = {}
    for key, val in params.items():
        if isinstance(val, date):
            serializable_params[key] = val.isoformat()
        else:
            serializable_params[key] = val

    return IndicadorSQLPreviewResponse(
        sql=query_sql,
        params=serializable_params,
        periodo_inicio=periodo_inicio,
        periodo_fin=periodo_fin,
        version_id=version.id,
        version_num=version.version,
    )
