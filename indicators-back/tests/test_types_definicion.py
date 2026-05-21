"""Basic validation tests for the indicator metamodel."""
import pytest
from pydantic import ValidationError
from app.types.definicion import (
    DefinicionIndicador,
    FiltrosEvento,
    FiltrosPoblacion,
    FiltroDiagnostico,
    FiltroOrden,
)


class TestDefinicionIndicador:
    """Minimal valid definicion + a couple error cases."""

    def test_minimal_valid(self):
        """tipo + periodo is the absolute minimum."""
        d = DefinicionIndicador(tipo="conteo_atenciones", periodo="mes_actual")
        assert d.tipo == "conteo_atenciones"
        assert d.evento is None

    def test_full_with_diagnosticos(self):
        """Real-world definition with nested diagnosticos inside evento."""
        d = DefinicionIndicador(
            tipo="conteo_atenciones",
            periodo="mes_actual",
            poblacion=FiltrosPoblacion(edad_max_dias=1825),
            evento=FiltrosEvento(
                encounter_type_uuids=["uuid-consulta-externa"],
                diagnosticos=[
                    FiltroDiagnostico(
                        concepto_uuid="uuid-diag-1",
                        tipo_diagnostico="definitivo",
                    ),
                ],
            ),
        )
        assert d.evento is not None
        assert d.evento.diagnosticos is not None
        assert d.evento.diagnosticos[0].concepto_uuid == "uuid-diag-1"
        assert d.evento.diagnosticos[0].tipo_diagnostico == "definitivo"

    def test_full_with_ordenes(self):
        """Real-world definition with nested ordenes inside evento."""
        d = DefinicionIndicador(
            tipo="conteo_pacientes",
            periodo="mes_actual",
            evento=FiltrosEvento(
                encounter_type_uuids=["uuid-consulta-externa"],
                ordenes=[
                    FiltroOrden(concepto_uuid="uuid-order-1"),
                    FiltroOrden(concepto_uuid="uuid-order-2"),
                ],
            ),
        )
        assert d.evento is not None
        assert d.evento.ordenes is not None
        assert len(d.evento.ordenes) == 2
        assert d.evento.ordenes[0].concepto_uuid == "uuid-order-1"

    def test_invalid_tipo_rejected(self):
        with pytest.raises(ValidationError):
            DefinicionIndicador(tipo="invalido", periodo="mes_actual")

    def test_invalid_minimo_ocurrencias_rejected(self):
        with pytest.raises(ValidationError):
            FiltrosEvento(encounter_type_uuids=["uuid-x"], minimo_ocurrencias=0)

    def test_poblacion_has_age_filter(self):
        p = FiltrosPoblacion(edad_min_dias=1)
        assert p.has_age_filter is True

        p2 = FiltrosPoblacion()
        assert p2.has_age_filter is False


class TestMutualExclusivity:
    """diagnosticos and ordenes are mutually exclusive in FiltrosEvento."""

    def test_only_diagnosticos_passes(self):
        ev = FiltrosEvento(
            encounter_type_uuids=["uuid-x"],
            diagnosticos=[FiltroDiagnostico(concepto_uuid="uuid-d")],
        )
        assert ev.diagnosticos is not None
        assert ev.ordenes is None

    def test_only_ordenes_passes(self):
        ev = FiltrosEvento(
            encounter_type_uuids=["uuid-x"],
            ordenes=[FiltroOrden(concepto_uuid="uuid-o")],
        )
        assert ev.ordenes is not None
        assert ev.diagnosticos is None

    def test_neither_passes(self):
        ev = FiltrosEvento(encounter_type_uuids=["uuid-x"])
        assert ev.diagnosticos is None
        assert ev.ordenes is None

    def test_both_set_fails(self):
        with pytest.raises(ValidationError, match="mutually exclusive"):
            FiltrosEvento(
                encounter_type_uuids=["uuid-x"],
                diagnosticos=[FiltroDiagnostico(concepto_uuid="uuid-d")],
                ordenes=[FiltroOrden(concepto_uuid="uuid-o")],
            )

    def test_both_inside_definicion_fails(self):
        with pytest.raises(ValidationError, match="mutually exclusive"):
            DefinicionIndicador(
                tipo="conteo_atenciones",
                periodo="mes_actual",
                evento=FiltrosEvento(
                    encounter_type_uuids=["uuid-x"],
                    diagnosticos=[FiltroDiagnostico(concepto_uuid="uuid-d")],
                    ordenes=[FiltroOrden(concepto_uuid="uuid-o")],
                ),
            )


class TestBackwardCompatNormalizer:
    """Old flat JSONB rows normalize to nested evento shape."""

    def test_old_flat_diagnostico_normalizes(self):
        old = {
            "tipo": "conteo_atenciones",
            "periodo": "mes_actual",
            "evento": {"encounter_type_uuids": ["uuid-x"]},
            "diagnostico": {
                "codigos_cie10": ["J00.X", "J04.0"],
                "tipo_diagnostico": "definitivo",
            },
        }
        d = DefinicionIndicador.model_validate(old)
        assert d.evento is not None
        assert d.evento.diagnosticos is not None
        assert len(d.evento.diagnosticos) == 1
        assert d.evento.diagnosticos[0].concepto_uuid == ""
        assert d.evento.diagnosticos[0].tipo_diagnostico == "definitivo"

    def test_old_flat_observaciones_normalizes_to_ordenes(self):
        old = {
            "tipo": "conteo_pacientes",
            "periodo": "mes_actual",
            "evento": {"encounter_type_uuids": ["uuid-x"]},
            "observaciones": [
                {"concepto_uuid": "uuid-a"},
                {"concepto_uuid": "uuid-b"},
            ],
        }
        d = DefinicionIndicador.model_validate(old)
        assert d.evento is not None
        assert d.evento.ordenes is not None
        assert len(d.evento.ordenes) == 2
        assert d.evento.ordenes[0].concepto_uuid == "uuid-a"
        assert d.evento.ordenes[1].concepto_uuid == "uuid-b"

    def test_old_flat_both_diagnostico_and_observaciones_are_mutually_exclusive(self):
        """Old data with both diagnostico + observaciones triggers mutual exclusivity."""
        old = {
            "tipo": "conteo_atenciones",
            "periodo": "mes_actual",
            "evento": {"encounter_type_uuids": ["uuid-x"]},
            "diagnostico": {"tipo_diagnostico": "definitivo"},
            "observaciones": [{"concepto_uuid": "uuid-a"}],
        }
        with pytest.raises(ValidationError, match="mutually exclusive"):
            DefinicionIndicador.model_validate(old)

    def test_new_nested_passes_through_unchanged(self):
        new_data = {
            "tipo": "conteo_atenciones",
            "periodo": "mes_actual",
            "evento": {
                "encounter_type_uuids": ["uuid-x"],
                "diagnosticos": [
                    {"concepto_uuid": "uuid-d", "tipo_diagnostico": "presuntivo"},
                ],
            },
        }
        d = DefinicionIndicador.model_validate(new_data)
        assert d.evento is not None
        assert d.evento.diagnosticos is not None
        assert d.evento.diagnosticos[0].concepto_uuid == "uuid-d"

    def test_idempotent_double_parse(self):
        """Double-validating produces identical model_dump."""
        old = {
            "tipo": "conteo_atenciones",
            "periodo": "mes_actual",
            "evento": {"encounter_type_uuids": ["uuid-x"]},
            "observaciones": [{"concepto_uuid": "uuid-a"}],
        }
        d1 = DefinicionIndicador.model_validate(old)
        dump1 = d1.model_dump(exclude_defaults=True)
        d2 = DefinicionIndicador.model_validate(dump1)
        dump2 = d2.model_dump(exclude_defaults=True)
        assert dump1 == dump2

    def test_old_eventos_array_picks_first(self):
        """Old multi-evento array: picks first element as singular evento."""
        old = {
            "tipo": "conteo_atenciones",
            "periodo": "mes_actual",
            "eventos": [
                {"encounter_type_uuids": ["uuid-first"]},
                {"encounter_type_uuids": ["uuid-second"]},
            ],
        }
        d = DefinicionIndicador.model_validate(old)
        assert d.evento is not None
        assert d.evento.encounter_type_uuids == ["uuid-first"]

    def test_old_diagnostico_no_tipo_skips(self):
        """Old diagnostico without tipo_diagnostico produces no diagnosticos."""
        old = {
            "tipo": "conteo_atenciones",
            "periodo": "mes_actual",
            "evento": {"encounter_type_uuids": ["uuid-x"]},
            "diagnostico": {"codigos_cie10": ["J00.X"]},
        }
        d = DefinicionIndicador.model_validate(old)
        assert d.evento is not None
        assert d.evento.diagnosticos is None


class TestFiltroDiagnosticoValidation:
    """Validates FiltroDiagnostico model constraints."""

    def test_valid_concepto_uuid(self):
        fd = FiltroDiagnostico(concepto_uuid="uuid-abc")
        assert fd.concepto_uuid == "uuid-abc"
        assert fd.tipo_diagnostico is None

    def test_valid_with_tipo(self):
        fd = FiltroDiagnostico(concepto_uuid="uuid-abc", tipo_diagnostico="definitivo")
        assert fd.tipo_diagnostico == "definitivo"

    def test_valid_empty_concepto_uuid(self):
        """Empty concepto_uuid accepted for backward compat (no filter applied)."""
        fd = FiltroDiagnostico(concepto_uuid="")
        assert fd.concepto_uuid == ""

    def test_invalid_tipo_rejected(self):
        with pytest.raises(ValidationError):
            FiltroDiagnostico(concepto_uuid="uuid-abc", tipo_diagnostico="invalido")


class TestFiltroOrdenValidation:
    """Validates FiltroOrden model constraints."""

    def test_valid_concepto_uuid(self):
        fo = FiltroOrden(concepto_uuid="uuid-order")
        assert fo.concepto_uuid == "uuid-order"

    def test_empty_concepto_uuid_rejected(self):
        with pytest.raises(ValidationError):
            FiltroOrden(concepto_uuid="")
