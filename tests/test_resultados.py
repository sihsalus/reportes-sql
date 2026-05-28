"""Smoke tests for the resultados router."""

import uuid
from datetime import date, datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client():
    """Return a TestClient wrapping the FastAPI app."""
    from app.main import app

    with TestClient(app) as c:
        yield c


# ── T1: Schema test ────────────────────────────────────────────────────


def test_resultado_list_response_uses_enriched_schema():
    """ResultadoListResponse.items must be typed as enriched responses."""
    from app.schemas.indicador import (
        IndicadorResultadoEnrichedResponse,
        ResultadoListResponse,
    )

    field_info = ResultadoListResponse.model_fields["items"]
    assert field_info.annotation == list[IndicadorResultadoEnrichedResponse]


# ── T2: GET /resultados enriched ───────────────────────────────────────


def test_get_resultados_returns_enriched_data(client: TestClient):
    """GET /resultados includes indicator name and version number."""
    from app.main import app
    from app.routers.resultados import get_db

    mock_indicador = MagicMock()
    mock_indicador.nombre = "Tasa de Cesáreas"

    mock_version = MagicMock()
    mock_version.version = 1
    mock_version.indicador = mock_indicador

    from app.models.indicador import IndicadorResultado

    mock_resultado = MagicMock(spec=IndicadorResultado)
    mock_resultado.id = uuid.UUID("a1b2c3d4-e5f6-7890-abcd-ef1234567890")
    mock_resultado.indicador_version_id = uuid.UUID(
        "b2c3d4e5-f6a7-8901-bcde-f23456789012"
    )
    mock_resultado.periodo_inicio = date(2026, 1, 1)
    mock_resultado.periodo_fin = date(2026, 1, 31)
    mock_resultado.valor = 42.5
    mock_resultado.calculado_en = datetime(
        2026, 1, 15, 10, 0, 0, tzinfo=timezone.utc
    )
    mock_resultado.indicador_version = mock_version

    mock_session = AsyncMock()
    mock_count_result = MagicMock()
    mock_count_result.scalar.return_value = 1
    mock_fetch_result = MagicMock()
    mock_scalars = MagicMock()
    mock_scalars.all.return_value = [mock_resultado]
    mock_fetch_result.scalars.return_value = mock_scalars
    mock_session.execute.side_effect = [mock_count_result, mock_fetch_result]

    app.dependency_overrides[get_db] = lambda: mock_session

    try:
        response = client.get("/resultados/")
        assert response.status_code == 200
        data = response.json()
        assert len(data["items"]) == 1
        assert data["items"][0]["indicador_nombre"] == "Tasa de Cesáreas"
        assert data["items"][0]["indicador_version_num"] == 1
    finally:
        app.dependency_overrides.pop(get_db, None)


def test_get_resultados_empty_list(client: TestClient):
    """GET /resultados returns empty enriched list when no results exist."""
    from app.main import app
    from app.routers.resultados import get_db

    mock_session = AsyncMock()
    mock_count_result = MagicMock()
    mock_count_result.scalar.return_value = 0
    mock_fetch_result = MagicMock()
    mock_scalars = MagicMock()
    mock_scalars.all.return_value = []
    mock_fetch_result.scalars.return_value = mock_scalars
    mock_session.execute.side_effect = [mock_count_result, mock_fetch_result]

    app.dependency_overrides[get_db] = lambda: mock_session

    try:
        response = client.get("/resultados/")
        assert response.status_code == 200
        data = response.json()
        assert data["items"] == []
        assert data["total"] == 0
        assert data["pages"] == 1
    finally:
        app.dependency_overrides.pop(get_db, None)


# ── T3: POST /calcular-ahora tests ─────────────────────────────────────


def test_calcular_ahora_success(client: TestClient):
    """POST /resultados/calcular-ahora calculates active indicators."""
    from app.main import app
    from app.models.indicador import Indicador, IndicadorVersion
    from app.routers.resultados import get_db

    mock_indicador = MagicMock(spec=Indicador)
    mock_indicador.id = uuid.UUID("c3d4e5f6-a7b8-9012-cdef-345678901234")
    mock_indicador.nombre = "Test Indicador"
    mock_indicador.activo = True

    mock_version = MagicMock(spec=IndicadorVersion)
    mock_version.id = uuid.UUID("d4e5f6a7-b8c9-0123-defa-456789012345")
    mock_version.indicador_id = mock_indicador.id
    mock_version.version = 1
    mock_version.definicion = {
        "tipo": "conteo_atenciones",
        "periodo": "mes_actual",
        "eventos": [
            {"encounter_type_uuids": ["123e4567-e89b-12d3-a456-426614174000"]}
        ],
    }

    mock_session = AsyncMock()
    mock_indicadores_result = MagicMock()
    mock_indicadores_result.scalars.return_value.all.return_value = [mock_indicador]
    mock_version_result = MagicMock()
    mock_version_result.scalar_one_or_none.return_value = mock_version
    mock_session.execute.side_effect = [mock_indicadores_result, mock_version_result]

    app.dependency_overrides[get_db] = lambda: mock_session

    with patch(
        "app.engine.interpreter.build_query", return_value=("SELECT 1", {})
    ) as mock_build:
        with patch(
            "app.engine.executor.execute_and_persist_async"
        ) as mock_execute:
            try:
                response = client.post("/resultados/calcular-ahora")
                assert response.status_code == 200
                data = response.json()
                assert data["calculados"] == 1
                assert data["total"] == 1
                assert data["errores"] == []
                mock_build.assert_called_once()
                mock_execute.assert_awaited_once()
            finally:
                app.dependency_overrides.pop(get_db, None)


def test_calcular_ahora_no_active_indicators(client: TestClient):
    """POST /resultados/calcular-ahora with no active indicators returns empty result."""
    from app.main import app
    from app.routers.resultados import get_db

    mock_session = AsyncMock()
    mock_indicadores_result = MagicMock()
    mock_indicadores_result.scalars.return_value.all.return_value = []
    mock_session.execute.return_value = mock_indicadores_result

    app.dependency_overrides[get_db] = lambda: mock_session

    try:
        response = client.post("/resultados/calcular-ahora")
        assert response.status_code == 200
        data = response.json()
        assert data["calculados"] == 0
        assert data["total"] == 0
        assert data["errores"] == []
    finally:
        app.dependency_overrides.pop(get_db, None)


def test_calcular_ahora_engine_error(client: TestClient):
    """POST /resultados/calcular-ahora catches engine errors and reports them."""
    from app.main import app
    from app.models.indicador import Indicador, IndicadorVersion
    from app.routers.resultados import get_db

    mock_indicador = MagicMock(spec=Indicador)
    mock_indicador.id = uuid.UUID("c3d4e5f6-a7b8-9012-cdef-345678901234")
    mock_indicador.nombre = "Test Indicador"
    mock_indicador.activo = True

    mock_version = MagicMock(spec=IndicadorVersion)
    mock_version.id = uuid.UUID("d4e5f6a7-b8c9-0123-defa-456789012345")
    mock_version.indicador_id = mock_indicador.id
    mock_version.version = 1
    mock_version.definicion = {
        "tipo": "conteo_atenciones",
        "periodo": "mes_actual",
        "eventos": [
            {"encounter_type_uuids": ["123e4567-e89b-12d3-a456-426614174000"]}
        ],
    }

    mock_session = AsyncMock()
    mock_indicadores_result = MagicMock()
    mock_indicadores_result.scalars.return_value.all.return_value = [mock_indicador]
    mock_version_result = MagicMock()
    mock_version_result.scalar_one_or_none.return_value = mock_version
    mock_session.execute.side_effect = [mock_indicadores_result, mock_version_result]

    app.dependency_overrides[get_db] = lambda: mock_session

    with patch(
        "app.engine.interpreter.build_query",
        side_effect=Exception("Engine BOOM"),
    ):
        try:
            response = client.post("/resultados/calcular-ahora")
            assert response.status_code == 200
            data = response.json()
            assert data["calculados"] == 0
            assert data["total"] == 1
            assert len(data["errores"]) == 1
            assert data["errores"][0]["indicador_nombre"] == "Test Indicador"
            assert "Engine BOOM" in data["errores"][0]["error"]
        finally:
            app.dependency_overrides.pop(get_db, None)
