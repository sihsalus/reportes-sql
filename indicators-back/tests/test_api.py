"""Smoke tests for the FastAPI application and router mounting.

Task 4.6: Verify the app boots, lifespan opens/closes pools, all routers respond.
These are behavioural smoke tests — they prove the application wiring works.
"""

import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient


# ── Fixtures ────────────────────────────────────────────────────────────


@pytest.fixture
def client():
    """Return a TestClient wrapping the FastAPI app.

    The lifespan context manager is properly exercised: startup runs before
    the first request, shutdown runs after the client context exits.
    """
    from app.main import app

    with TestClient(app) as c:
        yield c


# ── Import test ─────────────────────────────────────────────────────────


def test_app_imports_without_errors():
    """Verify the main module can be imported without exceptions."""
    # This also exercises lazy engine setup — no DB connection needed.
    from app.main import app  # noqa: F401

    assert app is not None
    assert app.title == "Motor de Indicadores SIH.SALUS"
    assert app.version == "0.1.0"


# ── Health endpoint ─────────────────────────────────────────────────────


def test_health_endpoint(client: TestClient):
    """GET /health returns 200 with status=ok."""
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


# ── Router mounting ─────────────────────────────────────────────────────


def test_all_routers_mounted(client: TestClient):
    """Verify all expected routes appear in the OpenAPI schema."""
    response = client.get("/openapi.json")
    assert response.status_code == 200

    schema = response.json()
    paths: dict = schema["paths"]

    # Health
    assert "/health" in paths

    # Indicadores router
    assert "/indicadores/" in paths  # POST
    assert "/indicadores/{indicador_id}" in paths  # GET + DELETE
    assert "/indicadores/{indicador_id}/versiones" in paths  # POST

    # Resultados router
    assert "/resultados/" in paths  # GET
    assert "/resultados/calcular-ahora" in paths  # POST

    # Conceptos router
    assert "/conceptos/encounter-types" in paths  # GET
    assert "/conceptos/buscar" in paths  # GET


# ── Schema validation ───────────────────────────────────────────────────


def test_indicadores_post_schema_requires_definicion(client: TestClient):
    """POST /indicadores rejects payloads missing the definicion field (422)."""
    response = client.post(
        "/indicadores/",
        json={"nombre": "Test", "descripcion": "Sin definicion"},
    )
    # Missing required field 'definicion' → 422
    assert response.status_code == 422


def test_indicadores_create_schema_validates_definicion():
    """The IndicadorCreate schema requires 'definicion' with a valid DefinicionIndicador.

    We test Pydantic validation directly — no DB needed. This proves the schema
    correctly validates the nested definicion field without attempting a connection.
    """
    from app.schemas.indicador import IndicadorCreate
    from pydantic import ValidationError

    # Valid payload
    IndicadorCreate(
        nombre="Tasa de Cesáreas",
        descripcion="Porcentaje de partos por cesárea",
        definicion={
            "tipo": "conteo_atenciones",
            "periodo": "mes_actual",
            "evento": {
                "encounter_type_uuids": ["123e4567-e89b-12d3-a456-426614174000"],
            },
        },
    )

    # Invalid: missing definicion
    with pytest.raises(ValidationError):
        IndicadorCreate(nombre="Test", descripcion="Sin definicion")

    # Invalid: bad tipo inside definicion
    with pytest.raises(ValidationError):
        IndicadorCreate(
            nombre="Test",
            definicion={
                "tipo": "tipo_invalido",
                "periodo": "mes_actual",
                "evento": {
                    "encounter_type_uuids": ["123e4567-e89b-12d3-a456-426614174000"],
                },
            },
        )


def test_indicador_update_schema_rejects_invalid_definicion():
    """IndicadorUpdate validates definicion when present.

    Valid definicion is accepted, missing tipo/eventos raises ValidationError.
    Pure Pydantic unit test — no DB or HTTP needed.
    """
    from app.schemas.indicador import IndicadorUpdate
    from pydantic import ValidationError

    # Valid: definicion present with all required fields
    update = IndicadorUpdate(
        nombre="Test",
        definicion={
            "tipo": "conteo_atenciones",
            "periodo": "mes_actual",
            "evento": {
                "encounter_type_uuids": [
                    "123e4567-e89b-12d3-a456-426614174000"
                ],
            },
        },
    )
    assert update.definicion is not None
    assert update.definicion.tipo == "conteo_atenciones"

    # Invalid: missing tipo
    with pytest.raises(ValidationError):
        IndicadorUpdate(
            nombre="Test",
            definicion={"periodo": "mes_actual"},
        )

    # Invalid: missing periodo
    with pytest.raises(ValidationError):
        IndicadorUpdate(
            nombre="Test",
            definicion={"tipo": "conteo_atenciones"},
        )

    # Invalid: bad tipo value
    with pytest.raises(ValidationError):
        IndicadorUpdate(
            nombre="Test",
            definicion={
                "tipo": "tipo_invalido",
                "periodo": "mes_actual",
                "evento": {
                    "encounter_type_uuids": [
                        "123e4567-e89b-12d3-a456-426614174000"
                    ],
                },
            },
        )


def test_conceptos_buscar_requires_q_param(client: TestClient):
    """GET /conceptos/buscar requires the 'q' query parameter (422)."""
    response = client.get("/conceptos/buscar")
    # Missing required query param 'q' → 422
    assert response.status_code == 422


def test_versioning_endpoint_exists(client: TestClient):
    """POST /indicadores/{id}/versiones endpoint is registered."""
    # We validate the endpoint exists by checking the schema
    response = client.get("/openapi.json")
    paths = response.json()["paths"]
    path_entry = paths["/indicadores/{indicador_id}/versiones"]
    assert "post" in path_entry
    # Verify the request body schema expects 'definicion'
    post_op = path_entry["post"]
    request_body = post_op.get("requestBody", {})
    assert request_body.get("required") is True


# ── UUID existence validation integration tests ────────────────────────

_VALID_UUID = "550e8400-e29b-41d4-a716-446655440000"
_UNKNOWN_UUID = "660e8400-e29b-41d4-a716-446655440001"


def _make_valid_payload(*, uuid_val: str = _VALID_UUID) -> dict:
    """Build a minimal valid POST /indicadores payload."""
    return {
        "nombre": "Indicador de prueba",
        "definicion": {
            "tipo": "conteo_atenciones",
            "periodo": "mes_actual",
            "evento": {"encounter_type_uuids": [uuid_val]},
        },
    }


def test_create_indicador_nonexistent_uuid(client: TestClient) -> None:
    """POST /indicadores with a valid-format UUID not in OpenMRS → 422."""
    mock_engine = MagicMock()
    mock_conn = MagicMock()
    mock_engine.connect.return_value.__enter__.return_value = mock_conn
    mock_conn.execute.return_value = []  # No UUIDs found

    with patch("app.validators.openmrs.get_sync_engine", return_value=mock_engine):
        response = client.post(
            "/indicadores/",
            json=_make_valid_payload(uuid_val=_UNKNOWN_UUID),
        )

    assert response.status_code == 422
    detail = response.json()["detail"]
    assert detail["field"] == "encounter_type_uuids"
    assert _UNKNOWN_UUID in detail["unknown_uuids"]


def test_create_version_nonexistent_uuid(client: TestClient) -> None:
    """POST /indicadores/{id}/versiones with non-existent UUID → 422."""
    mock_engine = MagicMock()
    mock_conn = MagicMock()
    mock_engine.connect.return_value.__enter__.return_value = mock_conn
    mock_conn.execute.return_value = []  # No UUIDs found

    with patch("app.validators.openmrs.get_sync_engine", return_value=mock_engine):
        response = client.post(
            f"/indicadores/{uuid.uuid4()}/versiones",
            json={"definicion": _make_valid_payload(uuid_val=_UNKNOWN_UUID)["definicion"]},
        )

    assert response.status_code == 422
    detail = response.json()["detail"]
    assert detail["field"] == "encounter_type_uuids"
    assert _UNKNOWN_UUID in detail["unknown_uuids"]


def test_create_indicador_openmrs_unreachable(client: TestClient) -> None:
    """POST /indicadores when OpenMRS is unreachable → 502."""
    mock_engine = MagicMock()
    mock_engine.connect.side_effect = Exception("Connection refused")

    with patch("app.validators.openmrs.get_sync_engine", return_value=mock_engine):
        response = client.post(
            "/indicadores/",
            json=_make_valid_payload(),
        )

    assert response.status_code == 502
    assert response.json()["detail"] == "OpenMRS no disponible"


# ── PUT /indicadores/{id} tests ────────────────────────────────────────


@pytest.fixture
def mock_indicador():
    """Return a mock Indicador model for PUT tests."""
    indicador = MagicMock()
    indicador.id = uuid.UUID("a1b2c3d4-e5f6-7890-abcd-ef1234567890")
    indicador.nombre = "Tasa Vieja"
    indicador.descripcion = "Descripción vieja"
    indicador.activo = True
    indicador.creado_en = "2026-01-15T10:30:00Z"
    return indicador


def mock_session_cleanup(app):
    """Remove DB dependency override to prevent cross-test pollution."""
    from app.routers.indicadores import get_db as _get_db

    app.dependency_overrides.pop(_get_db, None)


def test_put_indicador_success(client: TestClient, mock_indicador) -> None:
    """PUT /indicadores/{id} with valid payload → 200 and updated fields."""
    from app.routers.indicadores import get_db
    from app.main import app

    mock_session = AsyncMock()
    mock_result = MagicMock()
    mock_result.scalar_one_or_none.return_value = mock_indicador
    mock_session.execute.return_value = mock_result

    app.dependency_overrides[get_db] = lambda: mock_session

    try:
        response = client.put(
            f"/indicadores/{mock_indicador.id}",
            json={"nombre": "Tasa Nueva", "descripcion": "updated"},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["nombre"] == "Tasa Nueva"
        assert data["descripcion"] == "updated"
        mock_session.commit.assert_awaited_once()
        mock_session.refresh.assert_awaited_once_with(mock_indicador)
    finally:
        app.dependency_overrides.pop(get_db, None)


def test_put_indicador_not_found(client: TestClient) -> None:
    """PUT /indicadores/{id} for non-existent id → 404."""
    from app.routers.indicadores import get_db
    from app.main import app

    mock_session = AsyncMock()
    mock_result = MagicMock()
    mock_result.scalar_one_or_none.return_value = None
    mock_session.execute.return_value = mock_result

    app.dependency_overrides[get_db] = lambda: mock_session

    try:
        response = client.put(
            "/indicadores/00000000-0000-0000-0000-000000000000",
            json={"nombre": "Cualquiera", "descripcion": None},
        )
        assert response.status_code == 404
        assert response.json()["detail"] == "Indicador no encontrado"
    finally:
        app.dependency_overrides.pop(get_db, None)


def test_put_indicador_empty_nombre(client: TestClient) -> None:
    """PUT /indicadores/{id} with empty nombre → 422."""
    response = client.put(
        "/indicadores/a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        json={"nombre": ""},
    )
    assert response.status_code == 422


# ── PUT /indicadores/{id} auto-versioning tests ──────────────────────

_DEF_DIFF = {
    "tipo": "conteo_pacientes",
    "periodo": "mes_anterior",
    "evento": {"encounter_type_uuids": ["550e8400-e29b-41d4-a716-446655440000"]},
}

_DEF_SAME = {
    "tipo": "conteo_atenciones",
    "periodo": "mes_actual",
    "evento": {"encounter_type_uuids": ["123e4567-e89b-12d3-a456-426614174000"]},
}

_INDICADOR_ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890"


def _make_mock_version(*, version: int, definicion: dict):
    """Build a mock IndicadorVersion for test fixtures."""
    v = MagicMock()
    v.indicador_id = uuid.UUID(_INDICADOR_ID)
    v.version = version
    v.definicion = definicion
    return v


def _setup_put_mocks(app, *, indicador=None, latest_version=None, max_version=0):
    """Configure DB dependency override with ordered execute side_effect.

    Returns the mock session so tests can assert call details.
    """
    from app.routers.indicadores import get_db as _get_db

    mock_session = AsyncMock()
    results = []

    # First execute: fetch Indicador
    r1 = MagicMock()
    r1.scalar_one_or_none.return_value = indicador
    results.append(r1)

    # Second execute: fetch latest version (only if definicion present)
    if latest_version is not None:
        r2 = MagicMock()
        r2.scalar_one_or_none.return_value = latest_version
        results.append(r2)

    # Third execute: fetch max version (only when creating new version)
    r3 = MagicMock()
    r3.scalar.return_value = max_version
    results.append(r3)

    mock_session.execute.side_effect = results
    app.dependency_overrides[_get_db] = lambda: mock_session
    return mock_session


def test_put_indicador_no_definicion_metadata_only(
    client: TestClient, mock_indicador
) -> None:
    """PUT without definicion → metadata-only update, no version created."""
    from app.main import app

    mock_session = _setup_put_mocks(
        app, indicador=mock_indicador, latest_version=None
    )
    # Patch the validator so we can prove it was NOT called
    with patch("app.routers.indicadores.validar_definicion_encounter_uuids") as mock_val:
        response = client.put(
            f"/indicadores/{mock_indicador.id}",
            json={"nombre": "Nuevo", "descripcion": "Nueva desc"},
        )

    assert response.status_code == 200
    data = response.json()
    assert data["nombre"] == "Nuevo"
    assert data["descripcion"] == "Nueva desc"
    mock_val.assert_not_called()
    # No IndicadorVersion should have been added
    mock_session.add.assert_not_called()
    mock_session.commit.assert_awaited_once()
    mock_session.refresh.assert_awaited_once_with(mock_indicador)
    # Router must NOT query for latest version when definicion is absent
    assert mock_session.execute.call_count == 1  # only Indicador fetch

    mock_session_cleanup(app)


def test_put_indicador_definicion_identical_no_version(
    client: TestClient, mock_indicador
) -> None:
    """PUT with definicion identical to latest → metadata-only, no version created."""
    from app.main import app

    latest = _make_mock_version(version=2, definicion=_DEF_SAME)
    mock_session = _setup_put_mocks(
        app, indicador=mock_indicador, latest_version=latest
    )

    with patch("app.routers.indicadores.validar_definicion_encounter_uuids") as mock_val:
        response = client.put(
            f"/indicadores/{mock_indicador.id}",
            json={
                "nombre": "Renamed",
                "descripcion": None,
                "definicion": _DEF_SAME,
            },
        )

    assert response.status_code == 200
    data = response.json()
    assert data["nombre"] == "Renamed"
    assert mock_indicador.nombre == "Renamed"
    mock_val.assert_not_called()
    mock_session.add.assert_not_called()
    # Router MUST have queried for latest version (call 2)
    assert mock_session.execute.call_count >= 2

    mock_session_cleanup(app)


def test_put_indicador_with_definicion_auto_versions(
    client: TestClient, mock_indicador
) -> None:
    """PUT with definicion differing from latest → auto-creates version and returns 200."""
    from app.main import app

    latest = _make_mock_version(version=2, definicion=_DEF_SAME)
    mock_session = _setup_put_mocks(
        app, indicador=mock_indicador, latest_version=latest, max_version=2
    )

    with patch(
        "app.routers.indicadores.validar_definicion_encounter_uuids"
    ) as mock_val:
        response = client.put(
            f"/indicadores/{mock_indicador.id}",
            json={
                "nombre": "Con auto-version",
                "descripcion": "Cambió la definición",
                "definicion": _DEF_DIFF,
            },
        )

    assert response.status_code == 200
    data = response.json()
    assert data["nombre"] == "Con auto-version"
    mock_val.assert_called_once()
    # A new IndicadorVersion should have been added
    mock_session.add.assert_called_once()
    # Get the argument passed to add()
    added_obj = mock_session.add.call_args[0][0]
    assert added_obj.version == 3  # max(2) + 1

    mock_session_cleanup(app)


def test_put_indicador_definicion_invalid_uuids_422(
    client: TestClient, mock_indicador
) -> None:
    """PUT with definicion containing unknown encounter UUIDs → 422."""
    from app.main import app

    latest = _make_mock_version(version=1, definicion=_DEF_SAME)
    _setup_put_mocks(app, indicador=mock_indicador, latest_version=latest)

    mock_engine = MagicMock()
    mock_conn = MagicMock()
    mock_engine.connect.return_value.__enter__.return_value = mock_conn
    mock_conn.execute.return_value = []  # No UUIDs found

    with patch(
        "app.validators.openmrs.get_sync_engine", return_value=mock_engine
    ):
        response = client.put(
            f"/indicadores/{mock_indicador.id}",
            json={
                "nombre": "Test",
                "definicion": {
                    "tipo": "conteo_atenciones",
                    "periodo": "mes_actual",
                    "evento": {
                        "encounter_type_uuids": ["660e8400-e29b-41d4-a716-446655440001"],
                    },
                },
            },
        )

    assert response.status_code == 422
    detail = response.json()["detail"]
    assert detail["field"] == "encounter_type_uuids"

    mock_session_cleanup(app)


def test_put_indicador_definicion_openmrs_unreachable_502(
    client: TestClient, mock_indicador
) -> None:
    """PUT with definicion when OpenMRS is down → 502."""
    from app.main import app

    latest = _make_mock_version(version=1, definicion=_DEF_SAME)
    _setup_put_mocks(app, indicador=mock_indicador, latest_version=latest)

    mock_engine = MagicMock()
    mock_engine.connect.side_effect = Exception("Connection refused")

    with patch(
        "app.validators.openmrs.get_sync_engine", return_value=mock_engine
    ):
        response = client.put(
            f"/indicadores/{mock_indicador.id}",
            json={
                "nombre": "Test",
                "definicion": _DEF_DIFF,
            },
        )

    assert response.status_code == 502
    assert response.json()["detail"] == "OpenMRS no disponible"

    mock_session_cleanup(app)
