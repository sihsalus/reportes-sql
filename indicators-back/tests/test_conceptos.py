"""Tests for the diagnosis concept search endpoint and CIE-10 parsing.

Task 1.1 [RED]: Write tests BEFORE implementing the endpoint.
Covers: CIE-10 regex extraction, fallback to display, 400/502 errors,
and exclude_none behaviour on the response model.
"""

import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient
from httpx import HTTPStatusError, Request, RequestError, Response


# ── Fixtures ────────────────────────────────────────────────────────────


@pytest.fixture
def client():
    """Return a TestClient wrapping the FastAPI app."""
    from app.main import app

    with TestClient(app) as c:
        yield c


# ── Helpers ─────────────────────────────────────────────────────────────


def _openmrs_result(uuid_str: str, display: str, names: list[dict]) -> dict:
    """Build a single OpenMRS concept result dict matching v=full shape."""
    return {"uuid": uuid_str, "display": display, "names": names}


def _concept_with_cie10() -> dict:
    """OpenMRS concept where one name[] matches a CIE-10 code pattern."""
    return _openmrs_result(
        uuid_str="aaaa1111-bbbb-2222-cccc-333333333333",
        display="TOS FERINA",
        names=[
            {"display": "TOS FERINA", "locale": "es"},
            {"display": "A379", "locale": "es"},
            {"display": "WHOOPING COUGH", "locale": "en"},
        ],
    )


def _concept_without_cie10() -> dict:
    """OpenMRS concept with NO CIE-10 code in names."""
    return _openmrs_result(
        uuid_str="bbbb2222-cccc-3333-dddd-444444444444",
        display="CONSULTA EXTERNA",
        names=[
            {"display": "CONSULTA EXTERNA", "locale": "es"},
            {"display": "OUTPATIENT VISIT", "locale": "en"},
        ],
    )


def _concept_only_code() -> dict:
    """OpenMRS concept where the ONLY name[] entry is a CIE-10 code."""
    return _openmrs_result(
        uuid_str="cccc3333-dddd-4444-eeee-555555555555",
        display="A15.0",
        names=[{"display": "A150", "locale": "es"}],
    )


def _make_openmrs_response(results: list[dict]) -> dict:
    """Simulate a valid OpenMRS /concept response with v=full."""
    return {"results": results}


def _setup_openmrs_mock(response_json: dict | None = None, *, side_effect=None):
    """Configure httpx.AsyncClient mock with a sync JSON response.

    httpx.Response.raise_for_status() and .json() are synchronous methods.
    We use MagicMock for the response object (not AsyncMock) so that .json()
    returns the value directly, not wrapped in a coroutine.

    Returns the mock_client.get call tracker.
    """
    mock_response = MagicMock()
    mock_response.raise_for_status.return_value = None
    if response_json is not None:
        mock_response.json.return_value = response_json

    patcher = patch(
        "app.routers.conceptos.AsyncClient", autospec=True
    )
    mock_client_cls = patcher.start()

    mock_client = AsyncMock()
    if side_effect is not None:
        mock_client.get.side_effect = side_effect
    else:
        mock_client.get.return_value = mock_response

    mock_client_cls.return_value.__aenter__.return_value = mock_client

    return mock_client, patcher


# ── Pydantic model unit tests ───────────────────────────────────────────


class TestDiagnosticoConceptoOut:
    """Unit tests for the DiagnosticoConceptoOut Pydantic model (exclude_none)."""

    def test_model_excludes_codigo_when_none(self):
        """When codigo is None, exclude_none serialization omits the field."""
        from app.routers.conceptos import DiagnosticoConceptoOut

        obj = DiagnosticoConceptoOut(
            uuid=uuid.UUID("aaaa1111-bbbb-2222-cccc-333333333333"),
            codigo=None,
            nombre="CONSULTA EXTERNA",
        )
        data = obj.model_dump(exclude_none=True)
        assert data["uuid"] == uuid.UUID("aaaa1111-bbbb-2222-cccc-333333333333")
        assert data["nombre"] == "CONSULTA EXTERNA"
        assert "codigo" not in data

    def test_model_includes_codigo_when_present(self):
        """When codigo is set, all fields are present."""
        from app.routers.conceptos import DiagnosticoConceptoOut

        test_uuid = uuid.UUID("aaaa1111-bbbb-2222-cccc-333333333333")
        obj = DiagnosticoConceptoOut(
            uuid=test_uuid,
            codigo="A379",
            nombre="TOS FERINA",
        )
        data = obj.model_dump()
        assert data["codigo"] == "A379"
        assert data["nombre"] == "TOS FERINA"
        assert data["uuid"] == test_uuid


# ── CIE-10 extraction unit tests ────────────────────────────────────────


class TestCIEExtraction:
    """Unit tests for the CIE-10 regex extraction helper."""

    def test_extracts_cie10_code_from_names(self):
        """Given names with a CIE-10 pattern, extract the matching code."""
        from app.routers.conceptos import _extract_cie10_from_names

        names = [{"display": "TOS FERINA"}, {"display": "A379"}]
        assert _extract_cie10_from_names(names) == "A379"

    def test_extracts_nombre_skipping_code_patterns(self):
        """Given names with mixed code/text, extract the first non-code name."""
        from app.routers.conceptos import _extract_nombre_from_names

        names = [
            {"display": "A379"},
            {"display": "TOS FERINA"},
            {"display": "WHOOPING COUGH"},
        ]
        assert _extract_nombre_from_names(names) == "TOS FERINA"

    def test_extraction_no_cie10_returns_none(self):
        """When no name matches CIE-10 pattern, _extract_cie10 returns None."""
        from app.routers.conceptos import _extract_cie10_from_names

        names = [{"display": "CONSULTA EXTERNA"}, {"display": "OUTPATIENT VISIT"}]
        assert _extract_cie10_from_names(names) is None

    def test_extraction_only_code_returns_none_for_nombre(self):
        """When names only contain codes, _extract_nombre returns None."""
        from app.routers.conceptos import _extract_nombre_from_names

        names = [{"display": "A150"}]
        assert _extract_nombre_from_names(names) is None

    def test_cie10_regex_matches_letter_digit_combos(self):
        """The CIE-10 regex matches patterns like A379, B20, J180, Z718."""
        import re
        from app.routers.conceptos import _CIE10_RE

        assert re.match(_CIE10_RE, "A379")
        assert re.match(_CIE10_RE, "B20")
        assert re.match(_CIE10_RE, "J180")
        assert re.match(_CIE10_RE, "Z718")

    def test_cie10_regex_rejects_plain_text(self):
        """The CIE-10 regex rejects plain language display names."""
        import re
        from app.routers.conceptos import _CIE10_RE

        assert not re.match(_CIE10_RE, "TOS FERINA")
        assert not re.match(_CIE10_RE, "CONSULTA EXTERNA")
        assert not re.match(_CIE10_RE, "WHOOPING COUGH")
        assert not re.match(_CIE10_RE, "123")
        assert not re.match(_CIE10_RE, "")


# ── Endpoint integration tests ──────────────────────────────────────────


class TestDiagnosticosBuscarEndpoint:
    """Integration tests for GET /conceptos/diagnosticos/buscar?q=."""

    def test_returns_400_when_q_missing(self, client: TestClient):
        """Missing 'q' parameter → 400 Bad Request."""
        response = client.get("/conceptos/diagnosticos/buscar")
        assert response.status_code == 400
        assert "detail" in response.json()

    def test_returns_400_when_q_empty(self, client: TestClient):
        """Empty 'q' parameter → 400 Bad Request."""
        response = client.get("/conceptos/diagnosticos/buscar", params={"q": ""})
        assert response.status_code == 400

    def test_returns_400_when_q_whitespace(self, client: TestClient):
        """Whitespace-only 'q' → 400 Bad Request (stripped to empty)."""
        response = client.get("/conceptos/diagnosticos/buscar", params={"q": "   "})
        assert response.status_code == 400

    def test_returns_parsed_concepts_with_cie10_code(self, client: TestClient):
        """Search returns [{uuid, codigo, nombre}] when OpenMRS has CIE-10 codes."""
        mock_client, patcher = _setup_openmrs_mock(
            _make_openmrs_response([_concept_with_cie10()])
        )
        try:
            response = client.get(
                "/conceptos/diagnosticos/buscar", params={"q": "tos"}
            )
        finally:
            patcher.stop()

        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        assert len(data) == 1
        item = data[0]
        assert item["uuid"] == "aaaa1111-bbbb-2222-cccc-333333333333"
        assert item["codigo"] == "A379"
        assert item["nombre"] == "TOS FERINA"

    def test_returns_parsed_concept_without_cie10_omits_codigo(
        self, client: TestClient
    ):
        """When concept has no CIE-10 code, codigo is excluded from response."""
        mock_client, patcher = _setup_openmrs_mock(
            _make_openmrs_response([_concept_without_cie10()])
        )
        try:
            response = client.get(
                "/conceptos/diagnosticos/buscar", params={"q": "consulta"}
            )
        finally:
            patcher.stop()

        assert response.status_code == 200
        data = response.json()
        assert len(data) == 1
        item = data[0]
        assert item["uuid"] == "bbbb2222-cccc-3333-dddd-444444444444"
        assert "codigo" not in item
        assert item["nombre"] == "CONSULTA EXTERNA"

    def test_falls_back_to_root_display_when_names_are_code_only(
        self, client: TestClient
    ):
        """When names have only codes, nombre = root.display."""
        mock_client, patcher = _setup_openmrs_mock(
            _make_openmrs_response([_concept_only_code()])
        )
        try:
            response = client.get(
                "/conceptos/diagnosticos/buscar", params={"q": "A150"}
            )
        finally:
            patcher.stop()

        assert response.status_code == 200
        data = response.json()
        assert len(data) == 1
        item = data[0]
        assert item["uuid"] == "cccc3333-dddd-4444-eeee-555555555555"
        assert item["nombre"] == "A15.0"
        assert "codigo" in item
        assert item["codigo"] == "A150"

    def test_returns_502_on_openmrs_connection_error(self, client: TestClient):
        """OpenMRS unreachable → 502 Bad Gateway."""
        mock_client, patcher = _setup_openmrs_mock(
            side_effect=RequestError("Connection refused")
        )
        try:
            response = client.get(
                "/conceptos/diagnosticos/buscar", params={"q": "tos"}
            )
        finally:
            patcher.stop()

        assert response.status_code == 502

    def test_returns_502_on_openmrs_http_error(self, client: TestClient):
        """OpenMRS returns non-2xx → 502 Bad Gateway."""
        mock_client, patcher = _setup_openmrs_mock(
            side_effect=HTTPStatusError(
                "Server error",
                request=Request("GET", "http://fake"),
                response=Response(500),
            )
        )
        try:
            response = client.get(
                "/conceptos/diagnosticos/buscar", params={"q": "tos"}
            )
        finally:
            patcher.stop()

        assert response.status_code == 502

    def test_returns_502_on_openmrs_timeout(self, client: TestClient):
        """OpenMRS timeout → 502 Bad Gateway."""
        from httpx import TimeoutException

        mock_client, patcher = _setup_openmrs_mock(
            side_effect=TimeoutException("Request timed out")
        )
        try:
            response = client.get(
                "/conceptos/diagnosticos/buscar", params={"q": "tos"}
            )
        finally:
            patcher.stop()

        assert response.status_code == 502

    def test_returns_empty_list_when_no_results(self, client: TestClient):
        """OpenMRS returns empty results → JSON empty list, not 404."""
        mock_client, patcher = _setup_openmrs_mock({"results": []})
        try:
            response = client.get(
                "/conceptos/diagnosticos/buscar", params={"q": "zzz_no_existe"}
            )
        finally:
            patcher.stop()

        assert response.status_code == 200
        assert response.json() == []

    def test_returns_multiple_concepts_mixed_codes(self, client: TestClient):
        """When multiple results come back, each is parsed independently."""
        mock_client, patcher = _setup_openmrs_mock(
            _make_openmrs_response([_concept_with_cie10(), _concept_without_cie10()])
        )
        try:
            response = client.get(
                "/conceptos/diagnosticos/buscar", params={"q": "tos"}
            )
        finally:
            patcher.stop()

        assert response.status_code == 200
        data = response.json()
        assert len(data) == 2
        assert data[0]["codigo"] == "A379"
        assert "codigo" not in data[1]

    def test_openmrs_query_includes_v_full_and_class_diagnosis(
        self, client: TestClient
    ):
        """Verify the proxied OpenMRS URL includes v=full and class=Diagnosis."""
        mock_client, patcher = _setup_openmrs_mock({"results": []})
        try:
            client.get("/conceptos/diagnosticos/buscar", params={"q": "ira"})
        finally:
            patcher.stop()

        call_kwargs = mock_client.get.call_args
        assert call_kwargs is not None
        params = call_kwargs.kwargs.get("params") or call_kwargs[1].get("params")
        assert params["v"] == "full"
        assert params["class"] == "Diagnosis"
        assert params["limit"] == 10
        assert params["q"] == "ira"
