"""Basic SQL generation tests for the indicator engine."""
from datetime import date, timedelta

from app.engine.interpreter import build_query
from app.types.definicion import (
    DefinicionIndicador,
    FiltrosEvento,
    FiltrosPoblacion,
    FiltroDiagnostico,
    FiltroOrden,
)

UUID_LOC = "12345678-1234-1234-1234-123456789abc"
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
            evento=FiltrosEvento(location_uuids=[UUID_LOC]),
        )
        sql, params = build_query(definicion, INICIO, FIN)
        assert "COUNT(*)" in sql
        assert "location" in sql

    def test_conteo_pacientes(self):
        definicion = DefinicionIndicador(
            tipo="conteo_pacientes",
            periodo="mes_actual",
            evento=FiltrosEvento(location_uuids=[UUID_LOC]),
        )
        sql, params = build_query(definicion, INICIO, FIN)
        assert "COUNT(DISTINCT" in sql

    def test_minimo_ocurrencias_adds_subquery(self):
        definicion = DefinicionIndicador(
            tipo="conteo_atenciones",
            periodo="mes_actual",
            evento=FiltrosEvento(
                location_uuids=[UUID_LOC],
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
                location_uuids=[UUID_LOC],
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
                location_uuids=[UUID_LOC],
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
                location_uuids=[UUID_LOC],
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
                location_uuids=[UUID_LOC],
                diagnosticos=[
                    FiltroDiagnostico(
                        concepto_uuids=[UUID_DIAG, UUID_DIAG2],
                    ),
                ],
            ),
        )
        sql, params = build_query(definicion, INICIO, FIN)
        assert "c.uuid IN (%(diag_uuid_0_0)s, %(diag_uuid_0_1)s)" in sql
        assert params["diag_uuid_0_0"] == UUID_DIAG
        assert params["diag_uuid_0_1"] == UUID_DIAG2

    def test_diagnosticos_single_uuid_uses_parenthesized_placeholder(self):
        """Single UUID still uses IN (...) with a valid SQL placeholder list."""
        definicion = DefinicionIndicador(
            tipo="conteo_atenciones",
            periodo="mes_actual",
            evento=FiltrosEvento(
                location_uuids=[UUID_LOC],
                diagnosticos=[
                    FiltroDiagnostico(
                        concepto_uuids=[UUID_DIAG],
                        tipo_diagnostico="definitivo",
                    ),
                ],
            ),
        )
        sql, params = build_query(definicion, INICIO, FIN)
        assert "c.uuid IN (%(diag_uuid_0_0)s)" in sql
        assert params["diag_uuid_0_0"] == UUID_DIAG

    def test_diagnosticos_no_match_omits_filter(self):
        """When no diagnosticos have concept_uuids, no filter emitted."""
        definicion = DefinicionIndicador(
            tipo="conteo_atenciones",
            periodo="mes_actual",
            evento=FiltrosEvento(
                location_uuids=[UUID_LOC],
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
                location_uuids=[UUID_LOC],
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
                location_uuids=[UUID_LOC],
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
                location_uuids=[UUID_LOC],
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
                location_uuids=[UUID_LOC],
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
            evento=FiltrosEvento(location_uuids=[UUID_LOC]),
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
                location_uuids=[UUID_LOC],
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
                location_uuids=[UUID_LOC],
                minimo_ocurrencias=3,
                ordenes=[FiltroOrden(concepto_uuid=UUID_ORD)],
            ),
        )
        concept_map = {UUID_ORD: 42}
        sql, params = build_query(definicion, INICIO, FIN, concept_map=concept_map)
        assert "HAVING" in sql
        assert "orders" in sql

    def test_no_location_join_when_empty(self):
        """When location_uuids is None/empty, no location JOIN emitted."""
        definicion = DefinicionIndicador(
            tipo="conteo_atenciones",
            periodo="mes_actual",
            evento=FiltrosEvento(),
        )
        sql, params = build_query(definicion, INICIO, FIN)
        assert "JOIN location" not in sql

    def test_location_join_and_where_with_two_uuids(self):
        """Two location UUIDs → JOIN location + l.uuid IN (loc_0, loc_1)."""
        definicion = DefinicionIndicador(
            tipo="conteo_atenciones",
            periodo="mes_actual",
            evento=FiltrosEvento(
                location_uuids=[UUID_LOC, "uuid-loc-2"],
            ),
        )
        sql, params = build_query(definicion, INICIO, FIN)
        assert "JOIN location l ON e.location_id = l.location_id" in sql
        assert "l.uuid IN" in sql
        assert any(k.startswith("loc_") for k in params)


# ── Bugfix: exclusive upper bound on encounter_datetime ─────────────────


class TestFechaBoundsExclusive:
    """Verify that encounter_datetime uses inclusive lower + exclusive upper
    bound (>= inicio AND < fin+1day) to avoid dropping the final day."""

    def test_conteo_atenciones_uses_ge_and_lt(self):
        """conteo_atenciones: >= inicio AND < fin_excl, no BETWEEN."""
        d = DefinicionIndicador(
            tipo="conteo_atenciones",
            periodo="mes_actual",
            evento=FiltrosEvento(location_uuids=[UUID_LOC]),
        )
        sql, params = build_query(d, INICIO, FIN)
        assert "BETWEEN" not in sql
        assert "e.encounter_datetime >= %(inicio)s" in sql
        assert "e.encounter_datetime < %(fin_excl)s" in sql

    def test_conteo_pacientes_uses_ge_and_lt(self):
        """conteo_pacientes: >= inicio AND < fin_excl, no BETWEEN."""
        d = DefinicionIndicador(
            tipo="conteo_pacientes",
            periodo="mes_actual",
            evento=FiltrosEvento(location_uuids=[UUID_LOC]),
        )
        sql, params = build_query(d, INICIO, FIN)
        assert "BETWEEN" not in sql
        assert "e.encounter_datetime >= %(inicio)s" in sql
        assert "e.encounter_datetime < %(fin_excl)s" in sql

    def test_subquery_uses_ge_and_lt(self):
        """minimo_ocurrencias subquery also uses >= / < bounds."""
        d = DefinicionIndicador(
            tipo="conteo_atenciones",
            periodo="mes_actual",
            evento=FiltrosEvento(
                location_uuids=[UUID_LOC],
                minimo_ocurrencias=3,
            ),
        )
        sql, params = build_query(d, INICIO, FIN)
        assert "BETWEEN" not in sql
        assert "e.encounter_datetime >= %(inicio)s" in sql
        # Subquery also uses fin_excl
        assert "e.encounter_datetime < %(fin_excl)s" in sql

    def test_params_contain_fin_excl_not_fin(self):
        """Params dict uses fin_excl (inicio + 1 day), not legacy fin."""
        d = DefinicionIndicador(
            tipo="conteo_atenciones",
            periodo="mes_actual",
            evento=FiltrosEvento(location_uuids=[UUID_LOC]),
        )
        sql, params = build_query(d, INICIO, FIN)
        assert "fin_excl" in params
        assert "fin" not in params
        assert params["inicio"] == INICIO

    def test_fin_excl_is_inicio_plus_one_day(self):
        """fin_excl = fin + 1 day for full-day inclusive from user POV."""
        d = DefinicionIndicador(
            tipo="conteo_atenciones",
            periodo="mes_actual",
            evento=FiltrosEvento(location_uuids=[UUID_LOC]),
        )
        sql, params = build_query(d, INICIO, FIN)
        expected = FIN + timedelta(days=1)
        assert params["fin_excl"] == expected

    def test_fin_excl_correct_for_conteo_pacientes(self):
        """conteo_pacientes also computes fin_excl correctly."""
        d = DefinicionIndicador(
            tipo="conteo_pacientes",
            periodo="mes_actual",
            evento=FiltrosEvento(location_uuids=[UUID_LOC]),
        )
        sql, params = build_query(d, INICIO, FIN)
        expected = FIN + timedelta(days=1)
        assert params["fin_excl"] == expected

    def test_fin_excl_correct_for_subquery(self):
        """minimo_ocurrencias subquery params also have correct fin_excl."""
        d = DefinicionIndicador(
            tipo="conteo_atenciones",
            periodo="mes_actual",
            evento=FiltrosEvento(
                location_uuids=[UUID_LOC],
                minimo_ocurrencias=3,
            ),
        )
        sql, params = build_query(d, INICIO, FIN)
        expected = FIN + timedelta(days=1)
        assert params["fin_excl"] == expected


# ── Phase 2: Age filter SQL generation (canonical six-field) ─────────────


class TestAgeFilterSQL:
    """Unit-aware age filter SQL generation with DATEDIFF / DATE_ADD."""

    # ── min_dias (days, inclusive) ──

    def test_min_dias_generates_datediff_ge(self):
        """min_dias=1 → DATEDIFF >= %(min_dias)s."""
        d = DefinicionIndicador(
            tipo="conteo_atenciones",
            periodo="mes_actual",
            poblacion=FiltrosPoblacion(min_dias=1),
        )
        sql, params = build_query(d, INICIO, FIN)
        assert "DATEDIFF" in sql
        assert "p.birthdate" in sql
        assert "DATEDIFF(%(inicio)s, p.birthdate) >= %(min_dias)s" in sql
        assert "min_dias" in params
        assert params["min_dias"] == 1

    def test_min_dias_sql_contains_ge_operator(self):
        """min_dias=30 produces DATEDIFF >= ... clause."""
        d = DefinicionIndicador(
            tipo="conteo_atenciones",
            periodo="mes_actual",
            poblacion=FiltrosPoblacion(min_dias=30),
        )
        sql, params = build_query(d, INICIO, FIN)
        assert "DATEDIFF(%(inicio)s, p.birthdate) >= %(min_dias)s" in sql

    # ── max_dias (days, inclusive) ──

    def test_max_dias_generates_datediff_le(self):
        """max_dias=365 → DATEDIFF <= %(max_dias)s."""
        d = DefinicionIndicador(
            tipo="conteo_atenciones",
            periodo="mes_actual",
            poblacion=FiltrosPoblacion(max_dias=365),
        )
        sql, params = build_query(d, INICIO, FIN)
        assert "DATEDIFF(%(inicio)s, p.birthdate) <= %(max_dias)s" in sql
        assert params["max_dias"] == 365

    # ── min_meses (months, DATE_ADD) ──

    def test_min_meses_uses_date_add_month(self):
        """min_meses=6 → DATE_ADD(p.birthdate, INTERVAL 6 MONTH) <= inicio."""
        d = DefinicionIndicador(
            tipo="conteo_atenciones",
            periodo="mes_actual",
            poblacion=FiltrosPoblacion(min_meses=6),
        )
        sql, params = build_query(d, INICIO, FIN)
        assert "DATE_ADD(p.birthdate, INTERVAL %(min_meses)s MONTH)" in sql
        assert params["min_meses"] == 6

    def test_min_meses_compare_le_inicio(self):
        """DATE_ADD(...) <= inicio for minimum age in months."""
        d = DefinicionIndicador(
            tipo="conteo_atenciones",
            periodo="mes_actual",
            poblacion=FiltrosPoblacion(min_meses=12),
        )
        sql, _ = build_query(d, INICIO, FIN)
        assert "DATE_ADD(p.birthdate, INTERVAL %(min_meses)s MONTH) <= %(inicio)s" in sql

    # ── min_anios (years, DATE_ADD) ──

    def test_min_anios_uses_date_add_year(self):
        """min_anios=18 → DATE_ADD(p.birthdate, INTERVAL 18 YEAR) <= inicio."""
        d = DefinicionIndicador(
            tipo="conteo_atenciones",
            periodo="mes_actual",
            poblacion=FiltrosPoblacion(min_anios=18),
        )
        sql, params = build_query(d, INICIO, FIN)
        assert "DATE_ADD(p.birthdate, INTERVAL %(min_anios)s YEAR)" in sql
        assert params["min_anios"] == 18

    # ── max_meses_excl (exclusive, DATE_ADD >) ──

    def test_max_meses_excl_uses_date_add_gt(self):
        """max_meses_excl=6 → DATE_ADD(...) > inicio (exclusive bound)."""
        d = DefinicionIndicador(
            tipo="conteo_atenciones",
            periodo="mes_actual",
            poblacion=FiltrosPoblacion(max_meses_excl=6),
        )
        sql, params = build_query(d, INICIO, FIN)
        assert "DATE_ADD(p.birthdate, INTERVAL %(max_meses_excl)s MONTH)" in sql
        assert "> %(inicio)s" in sql
        assert params["max_meses_excl"] == 6

    def test_max_meses_excl_is_exclusive(self):
        """max_meses_excl uses > not >=."""
        d = DefinicionIndicador(
            tipo="conteo_atenciones",
            periodo="mes_actual",
            poblacion=FiltrosPoblacion(max_meses_excl=12),
        )
        sql, _ = build_query(d, INICIO, FIN)
        assert "DATE_ADD(p.birthdate, INTERVAL %(max_meses_excl)s MONTH) > %(inicio)s" in sql

    # ── max_anios_excl (exclusive, DATE_ADD >) ──

    def test_max_anios_excl_uses_date_add_year_gt(self):
        """max_anios_excl=5 → DATE_ADD(...) > inicio (exclusive bound)."""
        d = DefinicionIndicador(
            tipo="conteo_atenciones",
            periodo="mes_actual",
            poblacion=FiltrosPoblacion(max_anios_excl=5),
        )
        sql, params = build_query(d, INICIO, FIN)
        assert "DATE_ADD(p.birthdate, INTERVAL %(max_anios_excl)s YEAR)" in sql
        assert "> %(inicio)s" in sql
        assert params["max_anios_excl"] == 5

    def test_max_anios_excl_is_exclusive(self):
        """max_anios_excl uses > not >=."""
        d = DefinicionIndicador(
            tipo="conteo_atenciones",
            periodo="mes_actual",
            poblacion=FiltrosPoblacion(max_anios_excl=18),
        )
        sql, _ = build_query(d, INICIO, FIN)
        assert "DATE_ADD(p.birthdate, INTERVAL %(max_anios_excl)s YEAR) > %(inicio)s" in sql

    # ── Both bounds (min + max) ──

    def test_both_bounds_min_dias_max_anios_excl(self):
        """min_dias=30 + max_anios_excl=5 → both clauses in SQL."""
        d = DefinicionIndicador(
            tipo="conteo_atenciones",
            periodo="mes_actual",
            poblacion=FiltrosPoblacion(min_dias=30, max_anios_excl=5),
        )
        sql, params = build_query(d, INICIO, FIN)
        assert "DATEDIFF" in sql
        assert "DATE_ADD" in sql
        assert params["min_dias"] == 30
        assert params["max_anios_excl"] == 5

    def test_both_bounds_min_anios_max_dias(self):
        """min_anios=18 + max_dias=25550 → both clauses in SQL."""
        d = DefinicionIndicador(
            tipo="conteo_atenciones",
            periodo="mes_actual",
            poblacion=FiltrosPoblacion(min_anios=18, max_dias=25550),
        )
        sql, params = build_query(d, INICIO, FIN)
        assert "DATE_ADD" in sql
        assert "DATEDIFF" in sql
        assert params["min_anios"] == 18
        assert params["max_dias"] == 25550

    # ── No age filter ──

    def test_no_age_filter_no_person_join_for_age(self):
        """Without age filter, no person join added for age clause."""
        d = DefinicionIndicador(
            tipo="conteo_atenciones",
            periodo="mes_actual",
            evento=FiltrosEvento(location_uuids=[UUID_LOC]),
        )
        sql, _ = build_query(d, INICIO, FIN)
        assert "JOIN person" not in sql

    def test_sexo_only_still_adds_person_join_in_conteo_pacientes(self):
        """sexo-only filter in conteo_pacientes adds person join for gender."""
        d = DefinicionIndicador(
            tipo="conteo_pacientes",
            periodo="mes_actual",
            evento=FiltrosEvento(location_uuids=[UUID_LOC]),
            poblacion=FiltrosPoblacion(sexo="F"),
        )
        sql, params = build_query(d, INICIO, FIN)
        assert "p.gender" in sql
        assert params["sexo"] == "F"

    # ── Legacy normalization through interpreter ──

    def test_legacy_edad_min_dias_through_interpreter(self):
        """Legacy edad_min_dias=1 → generates min_dias DATEDIFF >= clause."""
        d = DefinicionIndicador(
            tipo="conteo_atenciones",
            periodo="mes_actual",
            poblacion=FiltrosPoblacion(edad_min_dias=1),
        )
        sql, params = build_query(d, INICIO, FIN)
        assert "DATEDIFF(%(inicio)s, p.birthdate) >= %(min_dias)s" in sql
        assert params["min_dias"] == 1

    def test_legacy_edad_max_anios_through_interpreter(self):
        """Legacy edad_max_anios=5 → generates max_anios_excl DATE_ADD > clause."""
        d = DefinicionIndicador(
            tipo="conteo_atenciones",
            periodo="mes_actual",
            poblacion=FiltrosPoblacion(edad_max_anios=5),
        )
        sql, params = build_query(d, INICIO, FIN)
        assert "DATE_ADD(p.birthdate, INTERVAL %(max_anios_excl)s YEAR) > %(inicio)s" in sql
        assert params["max_anios_excl"] == 5
