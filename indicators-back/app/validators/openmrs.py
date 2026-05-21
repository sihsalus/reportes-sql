"""OpenMRS sync validators — existence checks against the external OpenMRS database.

Design decision: keep I/O out of Pydantic models. Format validation happens
in DefinicionIndicador (Pydantic), existence checks happen here (router-level),
keeping models side-effect-free and testable in isolation.
"""

from fastapi import HTTPException, status
from sqlalchemy import text

from app.database import get_sync_engine


def validar_encounter_types(
    uuids: set[str],
    sync_engine=None,
) -> None:
    """Validate all UUID strings exist in OpenMRS encounter_type table.

    Queries the sync MySQL database with a single parameterized SELECT ...
    WHERE uuid IN (...) to avoid N+1 queries.

    Args:
        uuids: Set of UUID strings to validate.
        sync_engine: Optional sync engine (injected for testing).
                     When None, uses get_sync_engine() from app.database.

    Raises:
        HTTPException(422): One or more UUIDs not found in OpenMRS.
            Body: {"detail": {"field": "encounter_type_uuids",
                              "unknown_uuids": ["uuid-1", ...]}}
        HTTPException(502): MySQL connection failure or query error.
            Body: {"detail": "OpenMRS no disponible"}
    """
    if not uuids:
        return  # Nothing to validate — empty set.

    engine = sync_engine if sync_engine is not None else get_sync_engine()

    try:
        with engine.connect() as conn:
            result = conn.execute(
                text("SELECT uuid FROM encounter_type WHERE uuid IN :uuids"),
                {"uuids": tuple(uuids)},
            )
            encontrados = {row[0] for row in result}
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="OpenMRS no disponible",
        )

    desconocidos = uuids - encontrados
    if desconocidos:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail={
                "field": "encounter_type_uuids",
                "unknown_uuids": sorted(desconocidos),
            },
        )


def validar_definicion_encounter_uuids(
    definicion,
    sync_engine=None,
) -> None:
    """Collect unique encounter_type_uuids from the singular evento and validate.

    Convenience helper that extracts UUIDs from the singular evento in a
    definicion and passes them to validar_encounter_types() in a single call.

    Args:
        definicion: DefinicionIndicador instance (already Pydantic-validated).
        sync_engine: Optional sync engine (injected for testing).

    Raises:
        HTTPException(422): One or more UUIDs not found.
        HTTPException(502): OpenMRS unavailable.
    """
    all_uuids: set[str] = set()
    if definicion.evento is not None and definicion.evento.encounter_type_uuids:
        all_uuids.update(definicion.evento.encounter_type_uuids)
    validar_encounter_types(all_uuids, sync_engine=sync_engine)
