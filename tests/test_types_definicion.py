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
                location_uuids=["uuid-consulta-externa"],
                diagnosticos=[
                    FiltroDiagnostico(
                        concepto_uuids=["uuid-diag-1"],
                        tipo_diagnostico="definitivo",
                    ),
                ],
            ),
        )
        assert d.evento is not None
        assert d.evento.diagnosticos is not None
        assert d.evento.diagnosticos[0].concepto_uuids == ["uuid-diag-1"]
        assert d.evento.diagnosticos[0].tipo_diagnostico == "definitivo"

    def test_full_with_ordenes(self):
        """Real-world definition with nested ordenes inside evento."""
        d = DefinicionIndicador(
            tipo="conteo_pacientes",
            periodo="mes_actual",
            evento=FiltrosEvento(
                location_uuids=["uuid-consulta-externa"],
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
            FiltrosEvento(location_uuids=["uuid-x"], minimo_ocurrencias=0)

    def test_poblacion_has_age_filter(self):
        p = FiltrosPoblacion(edad_min_dias=1)
        assert p.has_age_filter is True

        p2 = FiltrosPoblacion()
        assert p2.has_age_filter is False


class TestMutualExclusivity:
    """diagnosticos and ordenes are mutually exclusive in FiltrosEvento."""

    def test_only_diagnosticos_passes(self):
        ev = FiltrosEvento(
            location_uuids=["uuid-x"],
            diagnosticos=[FiltroDiagnostico(concepto_uuids=["uuid-d"])],
        )
        assert ev.diagnosticos is not None
        assert ev.ordenes is None

    def test_only_ordenes_passes(self):
        ev = FiltrosEvento(
            location_uuids=["uuid-x"],
            ordenes=[FiltroOrden(concepto_uuid="uuid-o")],
        )
        assert ev.ordenes is not None
        assert ev.diagnosticos is None

    def test_neither_passes(self):
        ev = FiltrosEvento(location_uuids=["uuid-x"])
        assert ev.diagnosticos is None
        assert ev.ordenes is None

    def test_both_set_fails(self):
        with pytest.raises(ValidationError, match="mutually exclusive"):
            FiltrosEvento(
                location_uuids=["uuid-x"],
                diagnosticos=[FiltroDiagnostico(concepto_uuids=["uuid-d"])],
                ordenes=[FiltroOrden(concepto_uuid="uuid-o")],
            )

    def test_both_inside_definicion_fails(self):
        with pytest.raises(ValidationError, match="mutually exclusive"):
            DefinicionIndicador(
                tipo="conteo_atenciones",
                periodo="mes_actual",
                evento=FiltrosEvento(
                    location_uuids=["uuid-x"],
                    diagnosticos=[FiltroDiagnostico(concepto_uuids=["uuid-d"])],
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
        assert d.evento.diagnosticos[0].concepto_uuids == []
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
            "evento": {"location_uuids": ["uuid-x"]},
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
                "location_uuids": ["uuid-x"],
                "diagnosticos": [
                    {"concepto_uuids": ["uuid-d"], "tipo_diagnostico": "presuntivo"},
                ],
            },
        }
        d = DefinicionIndicador.model_validate(new_data)
        assert d.evento is not None
        assert d.evento.diagnosticos is not None
        assert d.evento.diagnosticos[0].concepto_uuids == ["uuid-d"]

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
        assert d.evento.location_uuids == ["uuid-first"]

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

    def test_valid_concepto_uuids(self):
        fd = FiltroDiagnostico(concepto_uuids=["uuid-abc"])
        assert fd.concepto_uuids == ["uuid-abc"]
        assert fd.tipo_diagnostico is None

    def test_valid_with_tipo(self):
        fd = FiltroDiagnostico(concepto_uuids=["uuid-abc"], tipo_diagnostico="definitivo")
        assert fd.tipo_diagnostico == "definitivo"

    def test_valid_empty_concepto_uuids(self):
        """Empty concepto_uuids accepted for backward compat (no filter applied)."""
        fd = FiltroDiagnostico()
        assert fd.concepto_uuids == []

    def test_valid_multiple_uuids(self):
        """Multiple UUIDs in one FiltroDiagnostico."""
        fd = FiltroDiagnostico(concepto_uuids=["uuid-a", "uuid-b"])
        assert len(fd.concepto_uuids) == 2

    def test_invalid_tipo_rejected(self):
        with pytest.raises(ValidationError):
            FiltroDiagnostico(concepto_uuids=["uuid-abc"], tipo_diagnostico="invalido")


class TestFiltroOrdenValidation:
    """Validates FiltroOrden model constraints."""

    def test_valid_concepto_uuid(self):
        fo = FiltroOrden(concepto_uuid="uuid-order")
        assert fo.concepto_uuid == "uuid-order"

    def test_empty_concepto_uuid_rejected(self):
        with pytest.raises(ValidationError):
            FiltroOrden(concepto_uuid="")


# ── Phase 1: Canonical six-field age filter ─────────────────────────────


class TestFiltrosPoblacionCanonical:
    """Canonical six-field age filter: new field names, exclusivity, ge=0."""

    def test_canonical_min_dias_valid(self):
        """min_dias=30 is accepted as a valid canonical field."""
        p = FiltrosPoblacion(min_dias=30, sexo="F")
        assert p.min_dias == 30
        assert p.min_meses is None
        assert p.min_anios is None
        assert p.sexo == "F"

    def test_canonical_max_anios_excl_valid(self):
        """max_anios_excl=5 is a valid exclusive upper bound in years."""
        p = FiltrosPoblacion(max_anios_excl=5)
        assert p.max_anios_excl == 5
        assert p.max_dias is None

    def test_canonical_max_meses_excl_valid(self):
        """max_meses_excl=6 is a valid exclusive upper bound in months."""
        p = FiltrosPoblacion(max_meses_excl=6)
        assert p.max_meses_excl == 6

    def test_canonical_has_age_filter_true(self):
        """has_age_filter is True when any canonical field is set."""
        p = FiltrosPoblacion(min_anios=18)
        assert p.has_age_filter is True

    def test_canonical_has_age_filter_false(self):
        """has_age_filter is False when no age fields are set."""
        p = FiltrosPoblacion()
        assert p.has_age_filter is False

    def test_canonical_has_age_filter_sexo_only(self):
        """sexo alone does NOT trigger has_age_filter."""
        p = FiltrosPoblacion(sexo="F")
        assert p.has_age_filter is False

    def test_all_six_fields_default_none(self):
        """All six canonical fields default to None."""
        p = FiltrosPoblacion()
        assert p.min_dias is None
        assert p.min_meses is None
        assert p.min_anios is None
        assert p.max_dias is None
        assert p.max_meses_excl is None
        assert p.max_anios_excl is None

    def test_ge_zero_min_dias_rejected(self):
        """min_dias=-1 violates ge=0."""
        with pytest.raises(ValidationError):
            FiltrosPoblacion(min_dias=-1)

    def test_ge_zero_max_anios_excl_rejected(self):
        """max_anios_excl=-5 violates ge=0."""
        with pytest.raises(ValidationError):
            FiltrosPoblacion(max_anios_excl=-5)

    def test_ge_zero_min_meses_rejected(self):
        """min_meses=-1 violates ge=0."""
        with pytest.raises(ValidationError):
            FiltrosPoblacion(min_meses=-1)

    def test_ge_zero_max_meses_excl_rejected(self):
        """max_meses_excl=-1 violates ge=0."""
        with pytest.raises(ValidationError):
            FiltrosPoblacion(max_meses_excl=-1)

    def test_ge_zero_max_dias_rejected(self):
        """max_dias=-1 violates ge=0."""
        with pytest.raises(ValidationError):
            FiltrosPoblacion(max_dias=-1)

    def test_same_group_min_exclusivity_two(self):
        """min_dias=10 + min_meses=1 → same-group exclusivity violation."""
        with pytest.raises(ValidationError, match="mutually exclusive"):
            FiltrosPoblacion(min_dias=10, min_meses=1)

    def test_same_group_min_exclusivity_all_three(self):
        """min_dias=10 + min_meses=1 + min_anios=0 → exclusivity violation."""
        with pytest.raises(ValidationError, match="mutually exclusive"):
            FiltrosPoblacion(min_dias=10, min_meses=1, min_anios=0)

    def test_same_group_min_exclusivity_dias_anios(self):
        """min_dias=30 + min_anios=1 → exclusivity violation."""
        with pytest.raises(ValidationError, match="mutually exclusive"):
            FiltrosPoblacion(min_dias=30, min_anios=1)

    def test_same_group_max_exclusivity(self):
        """max_dias=100 + max_meses_excl=6 → same-group exclusivity violation."""
        with pytest.raises(ValidationError, match="mutually exclusive"):
            FiltrosPoblacion(max_dias=100, max_meses_excl=6)

    def test_same_group_max_exclusivity_dias_anios(self):
        """max_dias=365 + max_anios_excl=1 → exclusivity violation."""
        with pytest.raises(ValidationError, match="mutually exclusive"):
            FiltrosPoblacion(max_dias=365, max_anios_excl=1)

    def test_same_group_max_exclusivity_meses_anios(self):
        """max_meses_excl=6 + max_anios_excl=5 → exclusivity violation."""
        with pytest.raises(ValidationError, match="mutually exclusive"):
            FiltrosPoblacion(max_meses_excl=6, max_anios_excl=5)

    def test_cross_group_allowed_min_anios_max_anios(self):
        """One min and one max (different groups) is valid."""
        p = FiltrosPoblacion(min_anios=18, max_anios_excl=65)
        assert p.min_anios == 18
        assert p.max_anios_excl == 65

    def test_cross_group_allowed_min_dias_max_dias(self):
        """min_dias + max_dias (different groups) is valid."""
        p = FiltrosPoblacion(min_dias=30, max_dias=365)
        assert p.min_dias == 30
        assert p.max_dias == 365

    def test_cross_group_allowed_min_meses_max_meses(self):
        """min_meses + max_meses_excl (different groups) is valid."""
        p = FiltrosPoblacion(min_meses=6, max_meses_excl=24)
        assert p.min_meses == 6
        assert p.max_meses_excl == 24

    def test_model_dump_uses_canonical_names(self):
        """model_dump() emits canonical field names, never legacy ones."""
        p = FiltrosPoblacion(min_anios=5, max_dias=365, sexo="M")
        dump = p.model_dump(exclude_none=True)
        assert "min_anios" in dump
        assert "max_dias" in dump
        assert "edad_min_anios" not in dump
        assert "edad_max_dias" not in dump

    def test_exclusivity_error_from_definicion_context(self):
        """Same-group exclusivity errors surface when nesting inside DefinicionIndicador."""
        with pytest.raises(ValidationError, match="mutually exclusive"):
            DefinicionIndicador(
                tipo="conteo_atenciones",
                periodo="mes_actual",
                poblacion=FiltrosPoblacion(min_dias=10, min_meses=1),
            )


class TestFiltrosPoblacionLegacy:
    """Legacy field name normalization: edad_* fields map to canonical names."""

    def test_legacy_edad_min_anios_to_min_anios(self):
        """edad_min_anios=10 → normalizes to min_anios=10."""
        p = FiltrosPoblacion(edad_min_anios=10)
        assert p.min_anios == 10
        assert p.min_meses is None

    def test_legacy_edad_max_anios_to_max_anios_excl(self):
        """edad_max_anios=5 → normalizes to max_anios_excl=5 (exclusive bound)."""
        p = FiltrosPoblacion(edad_max_anios=5)
        assert p.max_anios_excl == 5

    def test_legacy_edad_min_meses_to_min_meses(self):
        """edad_min_meses=6 → normalizes to min_meses=6."""
        p = FiltrosPoblacion(edad_min_meses=6)
        assert p.min_meses == 6

    def test_legacy_edad_max_meses_to_max_meses_excl(self):
        """edad_max_meses=12 → normalizes to max_meses_excl=12 (exclusive bound)."""
        p = FiltrosPoblacion(edad_max_meses=12)
        assert p.max_meses_excl == 12

    def test_legacy_edad_min_dias_to_min_dias(self):
        """edad_min_dias=1 → normalizes to min_dias=1."""
        p = FiltrosPoblacion(edad_min_dias=1)
        assert p.min_dias == 1

    def test_legacy_edad_max_dias_to_max_dias(self):
        """edad_max_dias=1825 → normalizes to max_dias=1825 (still inclusive)."""
        p = FiltrosPoblacion(edad_max_dias=1825)
        assert p.max_dias == 1825

    def test_mixed_legacy_and_canonical_rejected(self):
        """Mixing old and new field names is rejected with a clear message."""
        with pytest.raises(ValidationError, match="Cannot mix"):
            FiltrosPoblacion(edad_min_anios=10, min_meses=6)

    def test_mixed_legacy_max_and_canonical_max_rejected(self):
        """Mixing old max and new max field names is rejected."""
        with pytest.raises(ValidationError, match="Cannot mix"):
            FiltrosPoblacion(edad_max_dias=100, max_anios_excl=5)

    def test_legacy_model_dump_uses_canonical_names(self):
        """After legacy normalization, model_dump() emits canonical names only."""
        p = FiltrosPoblacion(edad_min_anios=10, edad_max_dias=365)
        dump = p.model_dump(exclude_none=True)
        assert "min_anios" in dump
        assert "max_dias" in dump
        assert "edad_min_anios" not in dump
        assert "edad_max_dias" not in dump

    def test_legacy_has_age_filter(self):
        """has_age_filter works correctly after legacy normalization."""
        p = FiltrosPoblacion(edad_min_dias=1)
        assert p.has_age_filter is True

    def test_legacy_normalized_through_definicion(self):
        """Legacy payload normalizes correctly when nested inside DefinicionIndicador."""
        d = DefinicionIndicador(
            tipo="conteo_atenciones",
            periodo="mes_actual",
            poblacion=FiltrosPoblacion(edad_max_dias=1825),
            evento=FiltrosEvento(location_uuids=["uuid-x"]),
        )
        assert d.poblacion is not None
        assert d.poblacion.max_dias == 1825
        assert d.poblacion.has_age_filter is True


# ── Phase: location_uuids → FiltrosEvento (replaces encounter_type_uuids) ──


class TestFiltrosEventoLocation:
    """FiltrosEvento uses location_uuids instead of encounter_type_uuids."""

    def test_location_uuids_accepted(self):
        """location_uuids is accepted as a valid field in FiltrosEvento."""
        ev = FiltrosEvento(location_uuids=["uuid-a", "uuid-b"])
        assert ev.location_uuids == ["uuid-a", "uuid-b"]
        assert ev.minimo_ocurrencias is None

    def test_location_uuids_none_accepted(self):
        """location_uuids can be None (no service filter)."""
        ev = FiltrosEvento()
        assert ev.location_uuids is None

    def test_location_uuids_empty_list_accepted(self):
        """location_uuids can be an empty list."""
        ev = FiltrosEvento(location_uuids=[])
        assert ev.location_uuids == []

    def test_legacy_encounter_type_uuids_normalized_to_location_uuids(self):
        """FiltrosEvento before-validator maps encounter_type_uuids → location_uuids."""
        ev = FiltrosEvento(encounter_type_uuids=["uuid-legacy"])
        assert ev.location_uuids == ["uuid-legacy"]

    def test_legacy_normalization_not_in_model_dump(self):
        """model_dump() excludes encounter_type_uuids, only shows location_uuids."""
        ev = FiltrosEvento(encounter_type_uuids=["uuid-legacy"])
        dump = ev.model_dump(exclude_none=True)
        assert "location_uuids" in dump
        assert "encounter_type_uuids" not in dump

    def test_location_uuids_with_diagnosticos(self):
        """location_uuids works alongside diagnosticos."""
        ev = FiltrosEvento(
            location_uuids=["uuid-x"],
            diagnosticos=[FiltroDiagnostico(concepto_uuids=["uuid-d"])],
        )
        assert ev.location_uuids == ["uuid-x"]
        assert ev.diagnosticos is not None

    def test_location_uuids_with_minimo_ocurrencias(self):
        """location_uuids works alongside minimo_ocurrencias."""
        ev = FiltrosEvento(
            location_uuids=["uuid-x"],
            minimo_ocurrencias=3,
        )
        assert ev.location_uuids == ["uuid-x"]
        assert ev.minimo_ocurrencias == 3

    def test_location_uuids_in_definicion(self):
        """location_uuids flows through DefinicionIndicador correctly."""
        d = DefinicionIndicador(
            tipo="conteo_atenciones",
            periodo="mes_actual",
            evento=FiltrosEvento(location_uuids=["uuid-consulta-externa"]),
        )
        assert d.evento is not None
        assert d.evento.location_uuids == ["uuid-consulta-externa"]
