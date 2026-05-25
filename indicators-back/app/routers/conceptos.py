"""Conceptos proxy router — forwards requests to the OpenMRS REST API.

Task 4.4:
- GET /conceptos/encounter-types → proxy OpenMRS encountertype endpoint.
- GET /conceptos/buscar?q=...&clase=... → proxy OpenMRS concept search.
- GET /conceptos/diagnosticos/buscar?q= → proxy OpenMRS concept search
  with v=full and CIE-10 code extraction from names[] (Task 1.2).
- GET /conceptos/locations/resolve?uuids=... → batch resolve location UUIDs to display names.
- GET /conceptos/diagnosticos/resolve?uuids=... → batch resolve diagnosis UUIDs to {uuid, codigo?, nombre}.

All communication uses httpx.AsyncClient with Basic Auth. Connection errors
return 502 Bad Gateway with a descriptive message.
"""

import asyncio
import re
import uuid as _uuid
from typing import Optional

from fastapi import APIRouter, HTTPException, Query, status
from httpx import AsyncClient, BasicAuth, HTTPStatusError, RequestError, TimeoutException
from pydantic import BaseModel, ConfigDict

from app.config import settings

router = APIRouter()

# ── Auth helper ─────────────────────────────────────────────────────────


def _auth() -> BasicAuth:
    """Return BasicAuth credentials for the OpenMRS API."""
    return BasicAuth(
        username=settings.openmrs_api_user,
        password=settings.openmrs_api_password,
    )


def _openmrs_url(path: str) -> str:
    """Compose the full OpenMRS REST API URL.

    The base URL (settings.openmrs_api_url) is e.g. 'http://localhost:8080/openmrs'.
    We append '/ws/rest/v1' to reach the REST endpoints.
    """
    base = settings.openmrs_api_url.rstrip("/")
    return f"{base}/ws/rest/v1/{path.lstrip('/')}"


# ── CIE-10 extraction helpers ───────────────────────────────────────────

# Regex: Starts with a letter (A-Z), followed by one or more digits.
# Case-insensitive, anchored to the start of the string.
_CIE10_RE = re.compile(r"^[A-Z]\d", re.IGNORECASE)


def _extract_cie10_from_names(names: list[dict]) -> Optional[str]:
    """Return the first names[].display that matches the CIE-10 code pattern."""
    for entry in names:
        if _CIE10_RE.match(entry.get("display", "")):
            return entry["display"]
    return None


def _extract_nombre_from_names(names: list[dict]) -> Optional[str]:
    """Return the first names[].display that does NOT match the CIE-10 pattern."""
    for entry in names:
        if not _CIE10_RE.match(entry.get("display", "")):
            return entry["display"]
    return None


# ── Response model ──────────────────────────────────────────────────────


class DiagnosticoConceptoOut(BaseModel):
    """Diagnosis concept option returned by the search endpoint.

    `codigo` is optional and excluded from JSON when absent.
    `nombre` falls back to the root `display` if no suitable name is found.
    """

    model_config = ConfigDict(exclude_none=True)
    uuid: _uuid.UUID
    codigo: Optional[str] = None
    nombre: str


class LocationOptionOut(BaseModel):
    """Location option returned by the locations search endpoint.

    Mirrors OpenMRS location with uuid and display name.
    """

    uuid: _uuid.UUID
    display: str


# ── Endpoints ──────────────────────────────────────────────────────────


@router.get(
    "/encounter-types",
    summary="Proxy OpenMRS encounter types",
)
async def get_encounter_types():
    """Return all encounter types from OpenMRS as [{uuid, display}].

    Proxies: GET {OPENMRS_API_URL}/ws/rest/v1/encountertype?v=custom:(uuid,display)
    """
    url = _openmrs_url("encountertype")
    params = {"v": "custom:(uuid,display)"}

    try:
        async with AsyncClient(timeout=10.0) as client:
            response = await client.get(url, params=params, auth=_auth())
            response.raise_for_status()
            data = response.json()
            return [
                {"uuid": item["uuid"], "display": item["display"]}
                for item in data.get("results", [])
            ]
    except (RequestError, TimeoutException) as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Error conectando a OpenMRS: {exc}",
        )
    except HTTPStatusError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"OpenMRS respondió con error: {exc.response.status_code}",
        )


@router.get(
    "/buscar",
    summary="Proxy OpenMRS concept search",
)
async def buscar_conceptos(
    q: str = Query(..., min_length=1, description="Search text"),
    clase: str = Query(
        "Diagnosis",
        description="Concept class filter (e.g., Diagnosis, Finding, Test)",
    ),
):
    """Search OpenMRS concepts by name and class.

    Proxies: GET {OPENMRS_API_URL}/ws/rest/v1/concept?q={q}&class={clase}
             &v=custom:(uuid,display)&limit=50

    Returns a list of [{uuid, display}] matching the search criteria.
    """
    url = _openmrs_url("concept")
    params = {
        "q": q,
        "class": clase,
        "v": "custom:(uuid,display)",
        "limit": 50,
    }

    try:
        async with AsyncClient(timeout=10.0) as client:
            response = await client.get(url, params=params, auth=_auth())
            response.raise_for_status()
            data = response.json()
            return [
                {"uuid": item["uuid"], "display": item["display"]}
                for item in data.get("results", [])
            ]
    except (RequestError, TimeoutException) as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Error conectando a OpenMRS: {exc}",
        )
    except HTTPStatusError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"OpenMRS respondió con error: {exc.response.status_code}",
        )


@router.get(
    "/diagnosticos/buscar",
    summary="Buscar conceptos de diagnóstico con código CIE-10",
    response_model=list[DiagnosticoConceptoOut],
    response_model_exclude_none=True,
)
async def buscar_diagnosticos(
    q: str = Query(
        "",
        description="Search text for diagnosis concepts",
    ),
):
    """Search OpenMRS diagnosis concepts, extracting CIE-10 codes from names.

    Proxies: GET {OPENMRS_API_URL}/ws/rest/v1/concept
             ?q={q}&v=full&limit=10&class=Diagnosis

    For each result, extracts:
    - uuid from root
    - codigo from names[].display matching CIE-10 regex (/^[A-Z]\\d/i)
    - nombre from names[].display NOT matching the code pattern,
      falling back to root.display if no non-code name is found

    Returns 400 when q is empty or whitespace-only (after strip).
    Returns 502 on any OpenMRS connection or HTTP error.
    """
    query = q.strip()
    if not query:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="El parámetro 'q' es obligatorio y no puede estar vacío",
        )

    url = _openmrs_url("concept")
    params = {
        "q": query,
        "v": "full",
        "limit": 10,
        "class": "Diagnosis",
    }

    try:
        async with AsyncClient(timeout=10.0) as client:
            response = await client.get(url, params=params, auth=_auth())
            response.raise_for_status()
            data = response.json()

            results: list[DiagnosticoConceptoOut] = []
            for item in data.get("results", []):
                names: list[dict] = item.get("names", [])
                codigo = _extract_cie10_from_names(names)
                nombre = _extract_nombre_from_names(names)
                if nombre is None:
                    nombre = item.get("display", "Sin nombre")

                results.append(
                    DiagnosticoConceptoOut(
                        uuid=item["uuid"],
                        codigo=codigo,
                        nombre=nombre,
                    )
                )
            return results

    except (RequestError, TimeoutException) as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Error conectando a OpenMRS: {exc}",
        )
    except HTTPStatusError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"OpenMRS respondió con error: {exc.response.status_code}",
        )


@router.get(
    "/locations",
    summary="Proxy OpenMRS location search",
    response_model=list[LocationOptionOut],
)
async def buscar_locations(
    q: str = Query(
        "",
        min_length=0,
        description="Search text for location names",
    ),
):
    """Search OpenMRS locations by name.

    Proxies: GET {OPENMRS_API_URL}/ws/rest/v1/location
             ?q={seed}&v=custom:(uuid,display)&limit=200

    Returns a case-insensitive, contains-based match list (local filter)
    with uuid and display name.
    Returns 400 when q is empty or whitespace-only.
    Returns 502 on any OpenMRS connection or HTTP error.
    """
    query = q.strip()
    if not query:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="El parámetro 'q' es obligatorio y no puede estar vacío",
        )

    normalized_query = query.casefold()
    query_seed = normalized_query[:3]

    url = _openmrs_url("location")
    base_params = {
        "v": "custom:(uuid,display)",
        "limit": 200,
    }

    try:
        async with AsyncClient(timeout=10.0) as client:
            def _filter_locations(raw: dict) -> list[LocationOptionOut]:
                results: list[LocationOptionOut] = []
                for item in raw.get("results", []):
                    display = item.get("display", "")
                    if normalized_query in display.casefold():
                        results.append(
                            LocationOptionOut(uuid=item["uuid"], display=display)
                        )
                return results

            # First pass: query-derived seed.
            response = await client.get(
                url,
                params={**base_params, "q": query_seed},
                auth=_auth(),
            )
            response.raise_for_status()
            primary_results = _filter_locations(response.json())
            if primary_results:
                return primary_results

            # Fallback pass: broad seed used in this domain (UPSS* names).
            fallback_response = await client.get(
                url,
                params={**base_params, "q": "upss"},
                auth=_auth(),
            )
            fallback_response.raise_for_status()
            return _filter_locations(fallback_response.json())
    except (RequestError, TimeoutException) as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Error conectando a OpenMRS: {exc}",
        )
    except HTTPStatusError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"OpenMRS respondió con error: {exc.response.status_code}",
        )


# ── Batch Resolve Endpoints ──────────────────────────────────────────────


def _parse_uuid_list(raw: str) -> list[str]:
    """Parse a comma-separated UUID list into a deduplicated list.

    Strips whitespace from each token and filters out empty strings.
    """
    return list(dict.fromkeys(token.strip() for token in raw.split(",") if token.strip()))


@router.get(
    "/locations/resolve",
    summary="Batch resolve location UUIDs to display names",
    response_model=list[LocationOptionOut],
)
async def resolve_locations(
    uuids: str = Query(
        ...,
        min_length=1,
        description="Comma-separated location UUIDs to resolve",
    ),
):
    """Resolve one or more location UUIDs to {uuid, display} pairs.

    Calls OpenMRS GET /location/{uuid}?v=custom:(uuid,display) for each
    UUID in parallel. UUIDs that are not found in OpenMRS are silently
    skipped — only successfully resolved locations appear in the response.

    Returns 400 when the uuids list is empty after parsing.
    Returns 502 on any OpenMRS connection or HTTP error.
    """
    uuid_list = _parse_uuid_list(uuids)
    if not uuid_list:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="El parámetro 'uuids' debe contener al menos un UUID válido",
        )

    async def _fetch_one(client: AsyncClient, uid: str) -> Optional[dict]:
        url = _openmrs_url(f"location/{uid}")
        params = {"v": "custom:(uuid,display)"}
        try:
            resp = await client.get(url, params=params, auth=_auth())
            resp.raise_for_status()
            data = resp.json()
            return {"uuid": data["uuid"], "display": data["display"]}
        except HTTPStatusError as exc:
            if exc.response.status_code == 404:
                return None  # UUID not found — skip
            raise  # Re-raise other HTTP errors
        except (RequestError, TimeoutException):
            raise

    results: list[LocationOptionOut] = []
    try:
        async with AsyncClient(timeout=10.0) as client:
            fetched = await asyncio.gather(
                *[_fetch_one(client, uid) for uid in uuid_list],
                return_exceptions=False,
            )
            results = [
                LocationOptionOut(**item)
                for item in fetched
                if item is not None
            ]
    except (RequestError, TimeoutException) as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Error conectando a OpenMRS: {exc}",
        )
    except HTTPStatusError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"OpenMRS respondió con error: {exc.response.status_code}",
        )

    return results


@router.get(
    "/diagnosticos/resolve",
    summary="Batch resolve diagnosis concept UUIDs with CIE-10 extraction",
    response_model=list[DiagnosticoConceptoOut],
    response_model_exclude_none=True,
)
async def resolve_diagnosticos(
    uuids: str = Query(
        ...,
        min_length=1,
        description="Comma-separated diagnosis concept UUIDs to resolve",
    ),
):
    """Resolve one or more diagnosis concept UUIDs to {uuid, codigo?, nombre}.

    Calls OpenMRS GET /concept/{uuid}?v=full for each UUID in parallel.
    Extracts CIE-10 code and human-readable name from the names[] array.
    UUIDs not found in OpenMRS are silently skipped.

    Returns 400 when the uuids list is empty after parsing.
    Returns 502 on any OpenMRS connection or HTTP error.
    """
    uuid_list = _parse_uuid_list(uuids)
    if not uuid_list:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="El parámetro 'uuids' debe contener al menos un UUID válido",
        )

    async def _fetch_one(client: AsyncClient, uid: str) -> Optional[dict]:
        url = _openmrs_url(f"concept/{uid}")
        params = {"v": "full"}
        try:
            resp = await client.get(url, params=params, auth=_auth())
            resp.raise_for_status()
            item = resp.json()
            names: list[dict] = item.get("names", [])
            codigo = _extract_cie10_from_names(names)
            nombre = _extract_nombre_from_names(names)
            if nombre is None:
                nombre = item.get("display", "Sin nombre")
            result: dict = {"uuid": item["uuid"], "nombre": nombre}
            if codigo is not None:
                result["codigo"] = codigo
            return result
        except HTTPStatusError as exc:
            if exc.response.status_code == 404:
                return None
            raise
        except (RequestError, TimeoutException):
            raise

    results: list[DiagnosticoConceptoOut] = []
    try:
        async with AsyncClient(timeout=10.0) as client:
            fetched = await asyncio.gather(
                *[_fetch_one(client, uid) for uid in uuid_list],
                return_exceptions=False,
            )
            results = [
                DiagnosticoConceptoOut(**item)
                for item in fetched
                if item is not None
            ]
    except (RequestError, TimeoutException) as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Error conectando a OpenMRS: {exc}",
        )
    except HTTPStatusError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"OpenMRS respondió con error: {exc.response.status_code}",
        )

    return results
