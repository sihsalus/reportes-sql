"""Conceptos proxy router — forwards requests to the OpenMRS REST API.

Task 4.4:
- GET /conceptos/encounter-types → proxy OpenMRS encountertype endpoint.
- GET /conceptos/buscar?q=...&clase=... → proxy OpenMRS concept search.

All communication uses httpx.AsyncClient with Basic Auth. Connection errors
return 502 Bad Gateway with a descriptive message.
"""

from fastapi import APIRouter, HTTPException, Query, status
from httpx import AsyncClient, BasicAuth, HTTPStatusError, RequestError, TimeoutException

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
