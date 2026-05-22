"""Basic SQL generation tests for the indicator engine."""
from datetime import date

from app.engine.interpreter import build_query
from app.types.definicion import (
    DefinicionIndicador,
    FiltrosEvento,
    FiltrosPoblacion,
    FiltroDiagnostico,
    FiltroOrden,
)

UUID_ENC = "12345678-1234-1234-1234-123456789abc"
UUID_DIAG = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
UUID_DIAG2 = "11111111-2222-3333-4444-555555555555"
UUID_ORD = "ffffffff-gggg-hhhh-iiii-jjjjjjjjjjjj"
INICIO = date(2026, 4, 1)
FIN = date(2026, 4, 30)


class TestBuildQuery:
    """Core SQL generation scenarios — simple, focused."""

    def test_minimal_query(self):
        """Conteo de atenciones sin filtros."""
        definicion = DefinicionIndicador(
            tipo="conteo_atenciones",
            periodo="mes_actual",
            evento=FiltrosEvento(encounter_type_uuids=[UUID_ENC]),
        )
        sql, params = build_query(definicion, INICIO, FIN)
        assert "COUNT(*)" in sql
        assert "encounter_type" in sql

    def test_conteo_pacientes(self):
        definicion = DefinicionIndicador(
            tipo="conteo_pacientes",
            periodo="mes_actual",
            evento=FiltrosEvento(encounter_type_uuids=[UUID_ENC]),
        )
        sql, params = build_query(definicion, INICIO, FIN)
        assert "COUNT(DISTINCT" in sql

    def test_minimo_ocurrencias_adds_subquery(self):
        definicion = DefinicionIndicador(
            tipo="conteo_atenciones",
            periodo="mes_actual",
            evento=FiltrosEvento(
                encounter_type_uuids=[UUID_ENC],
                minimo_ocurrencias=3,
            ),
        )
        sql, params = build_query(definicion, INICIO, FIN)
        assert "HAVING" in sql

    def test_diagnosticos_join_and_filter(self):
        """Nested diagnosticos generates encounter_diagnosis + concept JOIN
        and filters by c.uuid + certainty."""
        definicion = DefinicionIndicador(
            tipo="conteo_atenciones",
            periodo="mes_actual",
            evento=FiltrosEvento(
                encounter_type_uuids=[UUID_ENC],
                diagnosticos=[
                    FiltroDiagnostico(
                        concepto_uuids=[UUID_DIAG],
                        tipo_diagnostico="definitivo",
                    ),
                ],
            ),
        )
        sql, params = build_query(definicion, INICIO, FIN)
        assert "encounter_diagnosis" in sql
        assert "concept c" in sql
        assert "c.uuid IN" in sql
        assert "ed.certainty" in sql
        assert "CONFIRMED" in params.values()

    def test_diagnosticos_presuntivo(self):
        """tipo_diagnostico="presuntivo" maps to certainty PROVISIONAL."""
        definicion = DefinicionIndicador(
            tipo="conteo_atenciones",
            periodo="mes_actual",
            evento=FiltrosEvento(
                encounter_type_uuids=[UUID_ENC],
                diagnosticos=[
                    FiltroDiagnostico(
                        concepto_uuids=[UUID_DIAG],
                        tipo_diagnostico="presuntivo",
                    ),
                ],
            ),
        )
        sql, params = build_query(definicion, INICIO, FIN)
        assert "ed.certainty" in sql
        assert "PROVISIONAL" in params.values()

    def test_diagnosticos_empty_uuids_omits_concept_filter(self):
        """Empty concepto_uuids emits only certainty filter, no concept JOIN."""
        definicion = DefinicionIndicador(
            tipo="conteo_atenciones",
            periodo="mes_actual",
            evento=FiltrosEvento(
                encounter_type_uuids=[UUID_ENC],
                diagnosticos=[
                    FiltroDiagnostico(
                        concepto_uuids=[],
                        tipo_diagnostico="definitivo",
                    ),
                ],
            ),
        )
        sql, params = build_query(definicion, INICIO, FIN)
        # certainty filter still present
        assert "ed.certainty" in sql
        # but no concept UUID filter
        assert "c.uuid IN" not in sql

    def test_diagnosticos_multiple_uuids_or_logic(self):
        """Multiple UUIDs in one FiltroDiagnostico use IN clause."""
        definicion = DefinicionIndicador(
            tipo="conteo_atenciones",
            periodo="mes_actual",
            evento=FiltrosEvento(
                encounter_type_uuids=[UUID_ENC],
                diagnosticos=[
                    FiltroDiagnostico(
                        concepto_uuids=[UUID_DIAG, UUID_DIAG2],
                    ),
                ],
            ),
        )
        sql, params = build_query(definicion, INICIO, FIN)
        assert "c.uuid IN" in sql
        # Both UUIDs should be in params
        found = False
        for v in params.values():
            if isinstance(v, tuple) and UUID_DIAG in v and UUID_DIAG2 in v:
                found = True
        assert found, "Params should contain tuple with both UUIDs"

    def test_diagnosticos_no_match_omits_filter(self):
        """When no diagnosticos have concept_uuids, no filter emitted."""
        definicion = DefinicionIndicador(
            tipo="conteo_atenciones",
            periodo="mes_actual",
            evento=FiltrosEvento(
                encounter_type_uuids=[UUID_ENC],
                diagnosticos=[
                    FiltroDiagnostico(concepto_uuids=[]),
                ],
            ),
        )
        sql, params = build_query(definicion, INICIO, FIN)
        assert "encounter_diagnosis" not in sql

    def test_ordenes_generates_exists(self):
        """Nested ordenes inside evento generates orders EXISTS subqueries."""
        definicion = DefinicionIndicador(
            tipo="conteo_atenciones",
            periodo="mes_actual",
            evento=FiltrosEvento(
                encounter_type_uuids=[UUID_ENC],
                ordenes=[FiltroOrden(concepto_uuid=UUID_ORD)],
            ),
        )
        concept_map = {UUID_ORD: 42}
        sql, params = build_query(definicion, INICIO, FIN, concept_map=concept_map)
        assert "EXISTS" in sql
        assert "orders" in sql

    def test_ordenes_multiple_and_logic(self):
        """Multiple ordenes use AND logic (all must be present)."""
        definicion = DefinicionIndicador(
            tipo="conteo_atenciones",
            periodo="mes_actual",
            evento=FiltrosEvento(
                encounter_type_uuids=[UUID_ENC],
                ordenes=[
                    FiltroOrden(concepto_uuid=UUID_ORD),
                    FiltroOrden(concepto_uuid="uuid-2"),
                ],
            ),
        )
        concept_map = {UUID_ORD: 42, "uuid-2": 99}
        sql, params = build_query(definicion, INICIO, FIN, concept_map=concept_map)
        # Two EXISTS clauses
        assert sql.count("EXISTS") == 2
        assert "orders o0" in sql
        assert "orders o1" in sql

    def test_ordenes_no_concept_map_omits(self):
        """Without concept_map, ordenes produce no filter."""
        definicion = DefinicionIndicador(
            tipo="conteo_atenciones",
            periodo="mes_actual",
            evento=FiltrosEvento(
                encounter_type_uuids=[UUID_ENC],
                ordenes=[FiltroOrden(concepto_uuid=UUID_ORD)],
            ),
        )
        sql, params = build_query(definicion, INICIO, FIN)
        assert "orders" not in sql

    def test_no_obs_table_references(self):
        """Old obs table should never be referenced."""
        definicion = DefinicionIndicador(
            tipo="conteo_atenciones",
            periodo="mes_actual",
            evento=FiltrosEvento(
                encounter_type_uuids=[UUID_ENC],
                ordenes=[FiltroOrden(concepto_uuid=UUID_ORD)],
            ),
        )
        concept_map = {UUID_ORD: 42}
        sql, params = build_query(definicion, INICIO, FIN, concept_map=concept_map)
        assert "obs" not in sql

    def test_poblacion_age_filter(self):
        definicion = DefinicionIndicador(
            tipo="conteo_atenciones",
            periodo="mes_actual",
            evento=FiltrosEvento(encounter_type_uuids=[UUID_ENC]),
            poblacion=FiltrosPoblacion(edad_min_dias=1),
        )
        sql, params = build_query(definicion, INICIO, FIN)
        assert "JOIN" in sql  # person join should be present

    def test_no_evento_returns_empty(self):
        """Singular evento can be None."""
        definicion = DefinicionIndicador(
            tipo="conteo_atenciones",
            periodo="mes_actual",
        )
        sql, params = build_query(definicion, INICIO, FIN)
        # Should not crash, query must be valid
        assert isinstance(sql, str)
        assert len(sql) > 0

    def test_minimo_ocurrencias_with_diagnosticos(self):
        """minimo_ocurrencias subquery includes diagnosticos filter."""
        definicion = DefinicionIndicador(
            tipo="conteo_atenciones",
            periodo="mes_actual",
            evento=FiltrosEvento(
                encounter_type_uuids=[UUID_ENC],
                minimo_ocurrencias=3,
                diagnosticos=[
                    FiltroDiagnostico(
                        concepto_uuids=[UUID_DIAG],
                        tipo_diagnostico="definitivo",
                    ),
                ],
            ),
        )
        sql, params = build_query(definicion, INICIO, FIN)
        assert "HAVING" in sql
        assert "encounter_diagnosis" in sql

    def test_minimo_ocurrencias_with_ordenes(self):
        """minimo_ocurrencias subquery includes ordenes filter."""
        definicion = DefinicionIndicador(
            tipo="conteo_atenciones",
            periodo="mes_actual",
            evento=FiltrosEvento(
                encounter_type_uuids=[UUID_ENC],
                minimo_ocurrencias=3,
                ordenes=[FiltroOrden(concepto_uuid=UUID_ORD)],
            ),
        )
        concept_map = {UUID_ORD: 42}
        sql, params = build_query(definicion, INICIO, FIN, concept_map=concept_map)
        assert "HAVING" in sql
        assert "orders" in sql
