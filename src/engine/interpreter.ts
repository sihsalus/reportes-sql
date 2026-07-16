/**
 * SQL builder — translates DefinicionIndicador into parameterized MySQL queries.
 *
 * All SQL generation lives here, isolated from routers and ORM.
 * User-supplied values (dates, numbers, strings) use MySQL :name
 * parameterized syntax for mysql2 namedPlaceholders. No string interpolation.
 */

import type {
  DefinicionIndicador,
  FiltroDiagnostico,
  FiltroOrden,
  FiltrosPoblacion,
} from "../types/definicion.js";
import { hasAgeFilter } from "../types/definicion.js";

// ── Helpers ───────────────────────────────────────────────────────────

function paramName(prefix: string, index: number): string {
  return `${prefix}_${index}`;
}

/**
 * Format a Date as 'YYYY-MM-DD' string for MySQL DATE parameters.
 */
function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(d: Date, days: number): Date {
  const result = new Date(d);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

// ── Public entry point ────────────────────────────────────────────────

export function buildQuery(
  definicion: DefinicionIndicador,
  periodoInicio: Date,
  periodoFin: Date,
  conceptMap?: Record<string, number> | null,
): { sql: string; params: Record<string, unknown> } {
  const finExcl = addDays(periodoFin, 1);

  if (definicion.tipo === "conteo_atenciones") {
    return buildConteoAtenciones(definicion, periodoInicio, finExcl, conceptMap ?? null);
  }
  return buildConteoPacientes(definicion, periodoInicio, finExcl, conceptMap ?? null);
}

// ── Internal builders ─────────────────────────────────────────────────

function buildConteoAtenciones(
  d: DefinicionIndicador,
  inicio: Date,
  finExcl: Date,
  conceptMap: Record<string, number> | null,
): { sql: string; params: Record<string, unknown> } {
  const params: Record<string, unknown> = {
    inicio: formatDate(inicio),
    fin_excl: formatDate(finExcl),
  };

  const selectCols = ["COUNT(*) as valor"];
  let tables = "encounter e";
  let joins = "";
  const conditions: string[] = [
    "e.encounter_datetime >= :inicio AND e.encounter_datetime < :fin_excl",
    "e.voided = 0",
  ];

  // ── Evento filter (location_uuids) ──
  const evento = d.evento;
  const locationUuids: string[] =
    evento?.location_uuids && evento.location_uuids.length > 0
      ? evento.location_uuids
      : [];

  if (locationUuids.length > 0) {
    joins += "\nJOIN location l ON e.location_id = l.location_id";
    const locPlaceholders = locationUuids
      .map((_, i) => `:${paramName("loc", i)}`)
      .join(", ");
    conditions.push(`l.uuid IN (${locPlaceholders})`);
    for (let i = 0; i < locationUuids.length; i++) {
      params[paramName("loc", i)] = locationUuids[i];
    }
  }

  const hasMinimo =
    evento != null &&
    evento.minimo_ocurrencias != null &&
    evento.minimo_ocurrencias > 1;

  // ── Diagnosticos filter ──
  const diagnosticos: FiltroDiagnostico[] | null =
    evento?.diagnosticos ?? null;
  const diagResult = buildDiagnosticosFilter(diagnosticos);
  if (diagResult.joins) {
    joins += "\n" + diagResult.joins;
  }
  if (diagResult.clause) {
    conditions.push(diagResult.clause);
    Object.assign(params, diagResult.params);
  }

  // ── Poblacion (age filter) ──
  if (d.poblacion != null && hasAgeFilter(d.poblacion) && !hasMinimo) {
    joins += "\nJOIN person p ON e.patient_id = p.person_id";
    conditions.push("p.voided = 0");
    const ageResult = buildAgeFilter(d.poblacion);
    conditions.push(ageResult.clause);
    Object.assign(params, ageResult.params);
  }

  // ── Ordenes filter ──
  const ordenes: FiltroOrden[] | null = evento?.ordenes ?? null;
  const ordResult = buildOrdenesFilter(ordenes, conceptMap);
  if (ordResult.clause) {
    conditions.push(ordResult.clause);
    Object.assign(params, ordResult.params);
  }

  const whereClause = "WHERE " + conditions.join("\n  AND ");

  let query =
    `SELECT ${selectCols.join(", ")}\n` +
    `FROM ${tables}\n` +
    `${joins}\n` +
    `${whereClause}`;

  // ── minimo_ocurrencias subquery ──
  if (hasMinimo) {
    const minOc = evento!.minimo_ocurrencias!;
    params["min_oc"] = minOc;
    const subquery = buildMinimoOcurrenciasSubquery({
      locationUuids,
      poblacion: d.poblacion ?? null,
      diagnosticos,
      params,
      paramKey: "min_oc",
      conceptMap,
      ordenes,
    });
    query += `\nAND e.patient_id IN (\n${subquery}\n)`;
  }

  query = query.trim() + ";";

  return { sql: query, params };
}

function buildConteoPacientes(
  d: DefinicionIndicador,
  inicio: Date,
  finExcl: Date,
  conceptMap: Record<string, number> | null,
): { sql: string; params: Record<string, unknown> } {
  const params: Record<string, unknown> = {
    inicio: formatDate(inicio),
    fin_excl: formatDate(finExcl),
  };

  const evento = d.evento;
  const locationUuids: string[] =
    evento?.location_uuids && evento.location_uuids.length > 0
      ? evento.location_uuids
      : [];

  const hasMinimo =
    evento != null &&
    evento.minimo_ocurrencias != null &&
    evento.minimo_ocurrencias > 1;

  const diagnosticos: FiltroDiagnostico[] | null =
    evento?.diagnosticos ?? null;
  const ordenes: FiltroOrden[] | null = evento?.ordenes ?? null;

  // ── minimo_ocurrencias subquery path ──
  if (hasMinimo) {
    const minOc = evento!.minimo_ocurrencias!;
    params["min_oc"] = minOc;
    const subquery = buildMinimoOcurrenciasSubquery({
      locationUuids,
      poblacion: d.poblacion ?? null,
      diagnosticos,
      params,
      paramKey: "min_oc",
      conceptMap,
      ordenes,
    });

    const query =
      `SELECT COUNT(DISTINCT patient_id) as valor\n` +
      `FROM (\n${subquery}\n) AS _sub`.trim() + ";";

    return { sql: query, params };
  }

  // ── Normal path ──
  const selectCols = ["COUNT(DISTINCT p.person_id) as valor"];
  let tables = "person p";
  let joins = "JOIN encounter e ON e.patient_id = p.person_id";

  const conditions: string[] = [
    "e.encounter_datetime >= :inicio AND e.encounter_datetime < :fin_excl",
    "e.voided = 0",
    "p.voided = 0",
  ];

  if (locationUuids.length > 0) {
    joins += "\nJOIN location l ON e.location_id = l.location_id";
    const locPlaceholders = locationUuids
      .map((_, i) => `:${paramName("loc", i)}`)
      .join(", ");
    conditions.push(`l.uuid IN (${locPlaceholders})`);
    for (let i = 0; i < locationUuids.length; i++) {
      params[paramName("loc", i)] = locationUuids[i];
    }
  }

  // ── Diagnosticos filter ──
  const diagResult = buildDiagnosticosFilter(diagnosticos);
  if (diagResult.joins) {
    joins += "\n" + diagResult.joins;
  }
  if (diagResult.clause) {
    conditions.push(diagResult.clause);
    Object.assign(params, diagResult.params);
  }

  // ── Age filter ──
  if (d.poblacion != null && hasAgeFilter(d.poblacion)) {
    const ageResult = buildAgeFilter(d.poblacion);
    conditions.push(ageResult.clause);
    Object.assign(params, ageResult.params);
  }

  // ── Sexo filter ──
  if (d.poblacion?.sexo != null) {
    params["sexo"] = d.poblacion.sexo;
    conditions.push("p.gender = :sexo");
  }

  // ── Ordenes filter ──
  const ordResult = buildOrdenesFilter(ordenes, conceptMap);
  if (ordResult.clause) {
    conditions.push(ordResult.clause);
    Object.assign(params, ordResult.params);
  }

  const whereClause = "WHERE " + conditions.join("\n  AND ");

  const query =
    `SELECT ${selectCols.join(", ")}\n` +
    `FROM ${tables}\n` +
    `${joins}\n` +
    `${whereClause}`.trim() + ";";

  return { sql: query, params };
}

// ── Subquery builder ──────────────────────────────────────────────────

interface SubqueryInput {
  locationUuids: string[];
  poblacion: FiltrosPoblacion | null;
  diagnosticos: FiltroDiagnostico[] | null;
  params: Record<string, unknown>;
  paramKey: string;
  conceptMap: Record<string, number> | null;
  ordenes: FiltroOrden[] | null;
}

function buildMinimoOcurrenciasSubquery(
  input: SubqueryInput,
): string {
  const {
    locationUuids,
    poblacion,
    diagnosticos,
    params,
    paramKey,
    conceptMap,
    ordenes,
  } = input;

  let tables = "encounter e";
  let joins = "";

  const conditions: string[] = [
    "e.encounter_datetime >= :inicio AND e.encounter_datetime < :fin_excl",
    "e.voided = 0",
  ];

  if (locationUuids.length > 0) {
    joins += "JOIN location l ON e.location_id = l.location_id";
    const locPlaceholders = locationUuids
      .map((_, i) => `:${paramName("loc", i)}`)
      .join(", ");
    conditions.push(`l.uuid IN (${locPlaceholders})`);
    for (let i = 0; i < locationUuids.length; i++) {
      params[paramName("loc", i)] = locationUuids[i];
    }
  }

  // ── Person join for poblacion filters ──
  let joinPerson = false;
  if (poblacion != null) {
    if (hasAgeFilter(poblacion) || poblacion.sexo != null) {
      joinPerson = true;
    }
  }

  if (joinPerson) {
    joins += "\nJOIN person p ON e.patient_id = p.person_id";
    conditions.push("p.voided = 0");

    if (poblacion != null && hasAgeFilter(poblacion)) {
      const ageResult = buildAgeFilter(poblacion);
      conditions.push(ageResult.clause);
      Object.assign(params, ageResult.params);
    }

    if (poblacion?.sexo != null) {
      params["sexo"] = poblacion.sexo;
      conditions.push("p.gender = :sexo");
    }
  }

  // ── Diagnosticos filter ──
  const diagResult = buildDiagnosticosFilter(diagnosticos);
  if (diagResult.joins) {
    joins += "\n" + diagResult.joins;
  }
  if (diagResult.clause) {
    conditions.push(diagResult.clause);
    Object.assign(params, diagResult.params);
  }

  // ── Ordenes filter ──
  const ordResult = buildOrdenesFilter(ordenes, conceptMap);
  if (ordResult.clause) {
    conditions.push(ordResult.clause);
    Object.assign(params, ordResult.params);
  }

  const whereClause = "WHERE " + conditions.join("\n  AND ");
  const selectCols = ["e.patient_id"];
  const groupClause = "GROUP BY e.patient_id";
  const havingClause = `HAVING COUNT(e.encounter_id) >= :${paramKey}`;

  return (
    `SELECT ${selectCols.join(", ")}\n` +
    `FROM ${tables}\n` +
    `${joins}\n` +
    `${whereClause}\n` +
    `${groupClause}\n` +
    `${havingClause}`
  );
}

// ── Filter builders ───────────────────────────────────────────────────

function buildOrdenesFilter(
  ordenes: FiltroOrden[] | null,
  conceptMap: Record<string, number> | null,
): { clause: string; params: Record<string, unknown> } {
  if (!ordenes || !conceptMap) return { clause: "", params: {} };

  const clauses: string[] = [];
  const oparams: Record<string, unknown> = {};

  for (let i = 0; i < ordenes.length; i++) {
    const f = ordenes[i];
    const conceptId = conceptMap[f.concepto_uuid];
    if (conceptId == null) continue;

    const paramKey = `ord_${i}`;
    oparams[paramKey] = conceptId;
    clauses.push(
      `EXISTS (\n` +
      `    SELECT 1 FROM orders o${i}\n` +
      `    WHERE o${i}.encounter_id = e.encounter_id\n` +
      `      AND o${i}.concept_id = :${paramKey}\n` +
      `      AND o${i}.voided = 0\n` +
      `)`,
    );
  }

  if (clauses.length === 0) return { clause: "", params: {} };

  return { clause: clauses.join("\nAND "), params: oparams };
}

function buildAgeFilter(
  poblacion: FiltrosPoblacion,
): { clause: string; params: Record<string, unknown> } {
  const clauses: string[] = [];
  const params: Record<string, unknown> = {};

  // ── Minimum bounds ──
  if (poblacion.min_dias != null) {
    params["min_dias"] = poblacion.min_dias;
    clauses.push("DATEDIFF(e.encounter_datetime, p.birthdate) >= :min_dias");
  } else if (poblacion.min_meses != null) {
    params["min_meses"] = poblacion.min_meses;
    clauses.push("DATE_ADD(p.birthdate, INTERVAL :min_meses MONTH) <= e.encounter_datetime");
  } else if (poblacion.min_anios != null) {
    params["min_anios"] = poblacion.min_anios;
    clauses.push("DATE_ADD(p.birthdate, INTERVAL :min_anios YEAR) <= e.encounter_datetime");
  }

  // ── Maximum bounds ──
  if (poblacion.max_dias != null) {
    params["max_dias"] = poblacion.max_dias;
    clauses.push("DATEDIFF(e.encounter_datetime, p.birthdate) <= :max_dias");
  } else if (poblacion.max_meses_excl != null) {
    params["max_meses_excl"] = poblacion.max_meses_excl;
    clauses.push(
      "DATE_ADD(p.birthdate, INTERVAL :max_meses_excl MONTH) > e.encounter_datetime",
    );
  } else if (poblacion.max_anios_excl != null) {
    params["max_anios_excl"] = poblacion.max_anios_excl;
    clauses.push(
      "DATE_ADD(p.birthdate, INTERVAL :max_anios_excl YEAR) > e.encounter_datetime",
    );
  }

  if (clauses.length === 0) return { clause: "", params: {} };

  return { clause: clauses.join(" AND "), params };
}

function buildDiagnosticosFilter(
  diagnosticos: FiltroDiagnostico[] | null,
): { joins: string; clause: string; params: Record<string, unknown> } {
  if (!diagnosticos || diagnosticos.length === 0) {
    return { joins: "", clause: "", params: {} };
  }

  const params: Record<string, unknown> = {};
  const conditions: string[] = [];

  // ── Concept UUID conditions (OR logic across items) ──
  const itemClauses: string[] = [];
  for (let i = 0; i < diagnosticos.length; i++) {
    const fd = diagnosticos[i];
    if (fd.concepto_uuids.length > 0) {
      const placeholders: string[] = [];
      for (let j = 0; j < fd.concepto_uuids.length; j++) {
        const pk = `diag_uuid_${i}_${j}`;
        params[pk] = fd.concepto_uuids[j];
        placeholders.push(`:${pk}`);
      }
      itemClauses.push(`c.uuid IN (${placeholders.join(", ")})`);
    }
  }

  if (itemClauses.length > 0) {
    conditions.push("(" + itemClauses.join(" OR ") + ")");
  }

  // ── Tipo diagnóstico → certainty mapping ──
  const firstTipo = diagnosticos.find(
    (fd) => fd.tipo_diagnostico != null,
  )?.tipo_diagnostico;

  if (firstTipo) {
    const certainty = firstTipo === "definitivo" ? "CONFIRMED" : "PROVISIONAL";
    params["diag_certainty"] = certainty;
    conditions.push("ed.certainty = :diag_certainty");
  }

  if (conditions.length === 0) {
    return { joins: "", clause: "", params: {} };
  }

  const joins =
    "JOIN encounter_diagnosis ed ON ed.encounter_id = e.encounter_id AND ed.voided = 0\n" +
    "JOIN concept c ON c.concept_id = ed.diagnosis_coded";
  const clause = conditions.join(" AND ");
  return { joins, clause, params };
}
