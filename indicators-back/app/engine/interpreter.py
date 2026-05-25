"""SQL builder — translates DefinicionIndicador into parameterized MySQL queries.

All SQL generation lives here, isolated from routers and ORM.
User-supplied values (dates, numbers, strings) use MySQL %(name)s
parameterized syntax. No string interpolation.
"""

from datetime import date

from app.types.definicion import (
    DefinicionIndicador,
    FiltroDiagnostico,
    FiltroOrden,
    FiltrosEvento,
    FiltrosPoblacion,
)


# ── Public entry point ────────────────────────────────────────────────


def build_query(
    definicion: DefinicionIndicador,
    periodo_inicio: date,
    periodo_fin: date,
    concept_map: dict[str, int] | None = None,
) -> tuple[str, dict]:
    """Translate an indicator definition into a parameterized MySQL query.

    Args:
        definicion: Fully validated indicator definition (Pydantic).
        periodo_inicio: Start date of the calculation period (inclusive).
        periodo_fin: End date of the calculation period (inclusive).
        concept_map: Resolved mapping from concepto string to OpenMRS concept_id.

    Returns:
        (sql_string, params_dict) — ready for PyMySQL `cursor.execute(sql, params)`.
    """
    if definicion.tipo == "conteo_atenciones":
        return _build_conteo_atenciones(definicion, periodo_inicio, periodo_fin, concept_map)
    return _build_conteo_pacientes(definicion, periodo_inicio, periodo_fin, concept_map)


# ── Internal builders ─────────────────────────────────────────────────


def _build_conteo_atenciones(
    d: DefinicionIndicador,
    inicio: date,
    fin: date,
    concept_map: dict[str, int] | None = None,
) -> tuple[str, dict]:
    """Build a COUNT(*) query across encounters matching filters.

    Single-evento only. No agrupacion or condicion_temporal.
    """
    params: dict = {
        "inicio": inicio,
        "fin": fin,
    }

    select_cols = ["COUNT(*) as valor"]
    tables = "encounter e"
    joins = ""
    conditions = [
        "e.encounter_datetime BETWEEN %(inicio)s AND %(fin)s",
        "e.voided = 0",
    ]

    # ── Evento filter (location_uuids) ──
    evento = d.evento
    location_uuids: list[str] = []
    if evento is not None and evento.location_uuids:
        location_uuids = evento.location_uuids

    if location_uuids:
        joins += "\nJOIN location l ON e.location_id = l.location_id"
        loc_placeholders = ", ".join(
            f"%({_param_name('loc', i)})s" for i in range(len(location_uuids))
        )
        conditions.append(f"l.uuid IN ({loc_placeholders})")
        for i, u in enumerate(location_uuids):
            params[_param_name("loc", i)] = u

    has_minimo = (
        evento is not None
        and evento.minimo_ocurrencias is not None
        and evento.minimo_ocurrencias > 1
    )

    # ── Diagnosticos filter (nested in evento) ──
    diagnosticos: list[FiltroDiagnostico] | None = (
        evento.diagnosticos if evento is not None else None
    )
    diag_joins, diag_clause, diag_params = _build_diagnosticos_filter(diagnosticos)
    if diag_joins:
        joins += "\n" + diag_joins
    if diag_clause:
        conditions.append(diag_clause)
        params.update(diag_params)

    # ── Poblacion (age filter on person table) ──
    # When minimo_ocurrencias > 1 the age filter is applied inside
    # _build_minimo_ocurrencias_subquery (which joins person internally).
    # Avoid duplicating the person join — only join here for the
    # direct (no-minimo) aggregate path.
    if d.poblacion is not None and d.poblacion.has_age_filter and not has_minimo:
        joins += "\nJOIN person p ON e.patient_id = p.person_id"
        conditions.append("p.voided = 0")
        age_clause, age_params = _build_age_filter(d.poblacion)
        conditions.append(age_clause)
        params.update(age_params)

    # ── Poblacion (sexo-only, no age filter) + minimo_ocurrencias ──
    # When poblacion has sexo but no age filter, AND minimo_ocurrencias > 1,
    # we still need the person join for the subquery. The outer query
    # references e.patient_id directly so no person join needed at outer level.
    # The person join is handled inside the subquery below.

    # ── Ordenes filter (nested in evento) ──
    ordenes: list[FiltroOrden] | None = (
        evento.ordenes if evento is not None else None
    )
    ord_clause, ord_params = _build_ordenes_filter(ordenes, concept_map)
    if ord_clause:
        conditions.append(ord_clause)
        params.update(ord_params)

    where_clause = "WHERE " + "\n  AND ".join(conditions)

    query = (
        f"SELECT {', '.join(select_cols)}\n"
        f"FROM {tables}\n"
        f"{joins}\n"
        f"{where_clause}"
    )

    # ── minimo_ocurrencias subquery ──
    if has_minimo:
        params["min_oc"] = evento.minimo_ocurrencias  # type: ignore[union-attr]
        subquery = _build_minimo_ocurrencias_subquery(
            location_uuids=location_uuids,
            poblacion=d.poblacion,
            diagnosticos=diagnosticos,
            params=params,
            param_key="min_oc",
            concept_map=concept_map,
            ordenes=ordenes,
        )
        query += f"\nAND e.patient_id IN (\n{subquery}\n)"

    query = query.strip() + ";"

    return query, params


def _build_conteo_pacientes(
    d: DefinicionIndicador,
    inicio: date,
    fin: date,
    concept_map: dict[str, int] | None = None,
) -> tuple[str, dict]:
    """Build a COUNT(DISTINCT patient) query — no GROUP BY, scalar aggregate.

    Single-evento only. No agrupacion or condicion_temporal.
    """
    params: dict = {
        "inicio": inicio,
        "fin": fin,
    }

    # ── Evento filter ──
    evento = d.evento
    location_uuids: list[str] = []
    if evento is not None and evento.location_uuids:
        location_uuids = evento.location_uuids

    has_minimo = (
        evento is not None
        and evento.minimo_ocurrencias is not None
        and evento.minimo_ocurrencias > 1
    )

    diagnosticos: list[FiltroDiagnostico] | None = (
        evento.diagnosticos if evento is not None else None
    )
    ordenes: list[FiltroOrden] | None = (
        evento.ordenes if evento is not None else None
    )

    # ── minimo_ocurrencias subquery path ──
    if has_minimo:
        params["min_oc"] = evento.minimo_ocurrencias  # type: ignore[union-attr]
        subquery = _build_minimo_ocurrencias_subquery(
            location_uuids=location_uuids,
            poblacion=d.poblacion,
            diagnosticos=diagnosticos,
            params=params,
            param_key="min_oc",
            concept_map=concept_map,
            ordenes=ordenes,
        )

        query = (
            f"SELECT COUNT(DISTINCT patient_id) as valor\n"
            f"FROM (\n{subquery}\n) AS _sub"
        ).strip() + ";"

        return query, params

    # ── Normal path (no minimo_ocurrencias > 1) ──
    select_cols = ["COUNT(DISTINCT p.person_id) as valor"]
    tables = "person p"
    joins = "JOIN encounter e ON e.patient_id = p.person_id"

    conditions: list[str] = [
        "e.encounter_datetime BETWEEN %(inicio)s AND %(fin)s",
        "e.voided = 0",
        "p.voided = 0",
    ]

    if location_uuids:
        joins += "\nJOIN location l ON e.location_id = l.location_id"
        loc_placeholders = ", ".join(
            f"%({_param_name('loc', i)})s" for i in range(len(location_uuids))
        )
        conditions.append(f"l.uuid IN ({loc_placeholders})")
        for i, u in enumerate(location_uuids):
            params[_param_name("loc", i)] = u

    # ── Diagnosticos filter ──
    diag_joins, diag_clause, diag_params = _build_diagnosticos_filter(diagnosticos)
    if diag_joins:
        joins += "\n" + diag_joins
    if diag_clause:
        conditions.append(diag_clause)
        params.update(diag_params)

    # ── Age filter ──
    if d.poblacion is not None and d.poblacion.has_age_filter:
        age_clause, age_params = _build_age_filter(d.poblacion)
        conditions.append(age_clause)
        params.update(age_params)

    # ── Sexo filter ──
    if d.poblacion is not None and d.poblacion.sexo is not None:
        params["sexo"] = d.poblacion.sexo
        conditions.append("p.gender = %(sexo)s")

    # ── Ordenes filter ──
    ord_clause, ord_params = _build_ordenes_filter(ordenes, concept_map)
    if ord_clause:
        conditions.append(ord_clause)
        params.update(ord_params)

    where_clause = "WHERE " + "\n  AND ".join(conditions)

    query = (
        f"SELECT {', '.join(select_cols)}\n"
        f"FROM {tables}\n"
        f"{joins}\n"
        f"{where_clause}"
    ).strip() + ";"

    return query, params


def _build_minimo_ocurrencias_subquery(
    location_uuids: list[str],
    poblacion: FiltrosPoblacion | None,
    diagnosticos: list[FiltroDiagnostico] | None,
    params: dict,
    param_key: str,
    concept_map: dict[str, int] | None = None,
    ordenes: list[FiltroOrden] | None = None,
) -> str:
    """Build an inner subquery that identifies patients meeting the
    minimo_ocurrencias threshold.

    Returns patient_id for patients whose encounter count in the period
    meets the threshold. Embed in outer query via ``patient_id IN (...)``
    or ``FROM (...) AS _sub``.
    """
    tables = "encounter e"
    joins = ""

    if location_uuids:
        joins += "JOIN location l ON e.location_id = l.location_id"

    conditions: list[str] = [
        "e.encounter_datetime BETWEEN %(inicio)s AND %(fin)s",
        "e.voided = 0",
    ]

    if location_uuids:
        loc_placeholders = ", ".join(
            f"%({_param_name('loc', i)})s" for i in range(len(location_uuids))
        )
        conditions.append(f"l.uuid IN ({loc_placeholders})")
        for i, u in enumerate(location_uuids):
            params[_param_name("loc", i)] = u

    # ── Person join for poblacion filters ──
    join_person = False
    if poblacion is not None:
        if poblacion.has_age_filter or poblacion.sexo is not None:
            join_person = True

    if join_person:
        joins += "\nJOIN person p ON e.patient_id = p.person_id"
        conditions.append("p.voided = 0")

        if poblacion is not None and poblacion.has_age_filter:
            age_clause, age_params = _build_age_filter(poblacion)
            conditions.append(age_clause)
            params.update(age_params)

        if poblacion is not None and poblacion.sexo is not None:
            params["sexo"] = poblacion.sexo
            conditions.append("p.gender = %(sexo)s")

    # ── Diagnosticos filter (inside subquery) ──
    diag_joins, diag_clause, diag_params = _build_diagnosticos_filter(diagnosticos)
    if diag_joins:
        joins += "\n" + diag_joins
    if diag_clause:
        conditions.append(diag_clause)
        params.update(diag_params)

    # ── Ordenes filter (inside subquery) ──
    ord_clause, ord_params = _build_ordenes_filter(ordenes, concept_map)
    if ord_clause:
        conditions.append(ord_clause)
        params.update(ord_params)

    where_clause = "WHERE " + "\n  AND ".join(conditions)

    select_cols = ["e.patient_id"]
    group_clause = "GROUP BY e.patient_id"
    having_clause = f"HAVING COUNT(e.encounter_id) >= %({param_key})s"

    return (
        f"SELECT {', '.join(select_cols)}\n"
        f"FROM {tables}\n"
        f"{joins}\n"
        f"{where_clause}\n"
        f"{group_clause}\n"
        f"{having_clause}"
    )


# ── Helpers ───────────────────────────────────────────────────────────


def _build_ordenes_filter(
    ordenes: list[FiltroOrden] | None,
    concept_map: dict[str, int] | None,
) -> tuple[str, dict]:
    """Build EXISTS subqueries for order-based encounter filtering.

    Each FiltroOrden in ordenes generates one EXISTS subquery on the
    orders table. All subqueries use AND logic — every concept must be present.

    Args:
        ordenes: List of FiltroOrden from evento.ordenes, or None/[].
        concept_map: Resolved mapping from concepto string to OpenMRS concept_id.

    Returns:
        (clause_string, params_dict) — ready to append to WHERE conditions.
        Returns ("", {}) when ordenes is None or empty.
    """
    if not ordenes or concept_map is None:
        return "", {}

    clauses: list[str] = []
    oparams: dict = {}

    for i, f in enumerate(ordenes):
        concept_id = concept_map.get(f.concepto_uuid)
        if concept_id is None:
            continue
        param_key = f"ord_{i}"
        oparams[param_key] = concept_id
        clauses.append(
            f"EXISTS (\n"
            f"    SELECT 1 FROM orders o{i}\n"
            f"    WHERE o{i}.encounter_id = e.encounter_id\n"
            f"      AND o{i}.concept_id = %({param_key})s\n"
            f"      AND o{i}.voided = 0\n"
            f")"
        )

    if not clauses:
        return "", {}

    return "\nAND ".join(clauses), oparams


def _build_age_filter(
    poblacion: FiltrosPoblacion,
) -> tuple[str, dict]:
    """Build unit-aware age filter clauses from canonical FiltrosPoblacion.

    Day bounds use DATEDIFF (inclusive on both ends).
    Month/year bounds use DATE_ADD ... INTERVAL for calendar-precise math.
    Max-bounds are inclusive for days (<=), exclusive for months/years (>).

    Returns (clause_fragment, params_dict). The caller wraps the fragment
    in parentheses if needed.
    """
    clauses: list[str] = []
    params: dict = {}

    # ── Minimum bounds ──
    if poblacion.min_dias is not None:
        params["min_dias"] = poblacion.min_dias
        clauses.append(
            "DATEDIFF(%(inicio)s, p.birthdate) >= %(min_dias)s"
        )
    elif poblacion.min_meses is not None:
        params["min_meses"] = poblacion.min_meses
        clauses.append(
            "DATE_ADD(p.birthdate, INTERVAL %(min_meses)s MONTH) <= %(inicio)s"
        )
    elif poblacion.min_anios is not None:
        params["min_anios"] = poblacion.min_anios
        clauses.append(
            "DATE_ADD(p.birthdate, INTERVAL %(min_anios)s YEAR) <= %(inicio)s"
        )

    # ── Maximum bounds ──
    if poblacion.max_dias is not None:
        params["max_dias"] = poblacion.max_dias
        clauses.append(
            "DATEDIFF(%(inicio)s, p.birthdate) <= %(max_dias)s"
        )
    elif poblacion.max_meses_excl is not None:
        params["max_meses_excl"] = poblacion.max_meses_excl
        clauses.append(
            "DATE_ADD(p.birthdate, INTERVAL %(max_meses_excl)s MONTH) > %(inicio)s"
        )
    elif poblacion.max_anios_excl is not None:
        params["max_anios_excl"] = poblacion.max_anios_excl
        clauses.append(
            "DATE_ADD(p.birthdate, INTERVAL %(max_anios_excl)s YEAR) > %(inicio)s"
        )

    if not clauses:
        return "", {}

    return " AND ".join(clauses), params


def _build_diagnosticos_filter(
    diagnosticos: list[FiltroDiagnostico] | None,
) -> tuple[str, str, dict]:
    """Build JOINs and WHERE conditions for diagnosis-based filtering.

    Joins encounter_diagnosis → concept and filters by c.uuid IN (:uuids).
    Items use OR logic — an encounter must match at least one FiltroDiagnostico
    item. tipo_diagnostico (first non-None across all items) restricts by
    encounter_diagnosis.certainty.

    Args:
        diagnosticos: List of FiltroDiagnostico from evento.diagnosticos.

    Returns:
        (joins_string, clause_string, params_dict) or ("", "", {}).
        The caller appends joins_string to the query joins and
        clause_string to WHERE conditions.
    """
    if not diagnosticos:
        return "", "", {}

    params: dict = {}
    conditions: list[str] = []

    # ── Concept UUID conditions (OR logic across items) ──
    item_clauses: list[str] = []
    for i, fd in enumerate(diagnosticos):
        if fd.concepto_uuids:
            pk = f"diag_uuids_{i}"
            params[pk] = tuple(fd.concepto_uuids)
            item_clauses.append(f"c.uuid IN %({pk})s")

    if item_clauses:
        conditions.append("(" + " OR ".join(item_clauses) + ")")

    # ── Tipo diagnóstico → certainty mapping ──
    first_tipo = next(
        (fd.tipo_diagnostico for fd in diagnosticos if fd.tipo_diagnostico), None
    )
    if first_tipo:
        certainty = "CONFIRMED" if first_tipo == "definitivo" else "PROVISIONAL"
        params["diag_certainty"] = certainty
        conditions.append("ed.certainty = %(diag_certainty)s")

    if not conditions:
        return "", "", {}

    joins = (
        "JOIN encounter_diagnosis ed ON ed.encounter_id = e.encounter_id AND ed.voided = 0\n"
        "JOIN concept c ON c.concept_id = ed.diagnosis_coded"
    )
    clause = " AND ".join(conditions)
    return joins, clause, params


def _param_name(prefix: str, index: int) -> str:
    """Generate a unique parameter key for indexed lists."""
    return f"{prefix}_{index}"
