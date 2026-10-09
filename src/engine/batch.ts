/**
 * Batch calculation service — the orchestration shared by the HTTP handlers
 * (`calcular-ahora`, `recalcular-anio`) and the scheduled recalculation.
 *
 * Extracted from the router handlers so the same logic can run without a
 * `req`/`res` context: fetch active indicators, resolve the latest version and
 * order concepts in batch, then execute indicator × period with per-unit error
 * isolation, persisting canonical monthly rows via the executor and recording
 * every attempt in the calculation ledger.
 *
 * Stateless and side-effect-free at the boundary: it never reads the request
 * nor writes the response. Callers (routers, scheduler) own the transport and
 * the scheduling concerns.
 */

import { QueryTypes } from "sequelize";
import { sequelize } from "../database/postgres.js";
import { Indicador } from "../models/indicador.js";
import {
  parseDefinicionIndicador,
  type DefinicionIndicador,
} from "../types/definicion.js";
import { buildQuery } from "./interpreter.js";
import { executeAndPersist } from "./executor.js";
import { writeCalcLog } from "./calc-log.js";
import {
  calcularMesActual,
  calcularMesEspecifico,
} from "./periodo.js";
import { findLatestVersions } from "../indicators/latest-version.js";
import { resolveConceptMap } from "../validators/openmrs.js";
import { OpenMRSUnavailableError } from "../errors.js";
import { logger } from "../config/logger.js";

// ── Types ───────────────────────────────────────────────────────────────

/** One month to calculate, with its query bounds and persisted period label. */
export interface PeriodoCalculo {
  /** Year of the period, or null when the caller has no explicit year. */
  anio: number | null;
  /** Month (1-indexed) of the period, or null. */
  mes: number | null;
  /** Query lower bound (first day of month). */
  inicio: Date;
  /** Query upper bound — for the current month this is today. */
  fin: Date;
  /** Period end persisted as `periodo_fin` (always the month end). */
  finPersistencia: Date;
  /** Canonical month reference (first day of month). */
  mesReferencia: Date;
}

/** Per-unit failure surfaced to callers (indicators without version, unresolved concepts, errors). */
export interface ErrorCalculo {
  indicador_id: number;
  indicador_nombre: string;
  mes: number | null;
  error: string;
}

export interface BatchResult {
  /** Successfully persisted indicator × period units. */
  recalculados: number;
  errores: ErrorCalculo[];
  /** Total units attempted (indicators × periods). */
  total: number;
}

// ── Core batch ──────────────────────────────────────────────────────────

/**
 * Run the indicator × period batch against a set of indicators.
 *
 * Phases mirror the original handlers: (1) batch latest-version lookup,
 * (2) parse definitions + collect order concept UUIDs, (3) one concept
 * resolution, (4) per-indicator concept map, (5) per-unit execution with
 * error isolation and ledger writes.
 *
 * @throws OpenMRSUnavailableError when the batch concept resolution cannot
 *   reach OpenMRS — callers map this to HTTP 502.
 */
export async function runBatch(
  indicadores: Indicador[],
  periodos: PeriodoCalculo[],
  fuente: string,
): Promise<BatchResult> {
  const total = indicadores.length * periodos.length;
  const errores: ErrorCalculo[] = [];
  let recalculados = 0;

  // ── Phase 1: batch version lookup (single DISTINCT ON query) ──
  const versionMap = await findLatestVersions(indicadores.map((i) => i.id));

  // ── Phase 2: parse definitions + collect all concept UUIDs ──
  const definicionMap = new Map<number, DefinicionIndicador>();
  const allConceptUuids = new Set<string>();
  const withoutVersion: number[] = [];

  for (const indicador of indicadores) {
    const version = versionMap.get(indicador.id);
    if (!version) {
      withoutVersion.push(indicador.id);
      continue;
    }
    const definicion = parseDefinicionIndicador(version.definicion);
    definicionMap.set(indicador.id, definicion);
    for (const o of definicion.evento?.ordenes ?? []) {
      allConceptUuids.add(o.concepto_uuid);
    }
  }

  // ── Phase 3: batch concept resolution (single call) ──
  let globalConceptMap: Record<string, number> = {};
  if (allConceptUuids.size > 0) {
    globalConceptMap = await resolveConceptMap(Array.from(allConceptUuids));
  }

  // ── Phase 4: per-indicator concept map ──
  const conceptMapByIndicador = new Map<number, Record<string, number>>();
  const conceptErrorByIndicador = new Map<number, string>();

  for (const indicador of indicadores) {
    if (withoutVersion.includes(indicador.id)) continue;

    const definicion = definicionMap.get(indicador.id)!;
    const ordenes = definicion.evento?.ordenes;
    if (!ordenes || ordenes.length === 0) continue;

    const conceptMap: Record<string, number> = {};
    const missing: string[] = [];
    for (const o of ordenes) {
      const conceptId = globalConceptMap[o.concepto_uuid];
      if (conceptId !== undefined) conceptMap[o.concepto_uuid] = conceptId;
      else missing.push(o.concepto_uuid);
    }

    if (missing.length > 0) {
      conceptErrorByIndicador.set(
        indicador.id,
        `Conceptos de órdenes no encontrados: ${missing.join(", ")}`,
      );
    } else {
      conceptMapByIndicador.set(indicador.id, conceptMap);
    }
  }

  // ── Phase 5: per-indicator × per-period execution ──
  for (const indicador of indicadores) {
    if (withoutVersion.includes(indicador.id)) {
      for (const p of periodos) {
        errores.push({
          indicador_id: indicador.id,
          indicador_nombre: indicador.nombre,
          mes: p.mes,
          error: "Sin versiones definidas",
        });
        await writeCalcLog({
          indicador_id: indicador.id,
          indicador_version_id: null,
          mes_referencia: p.mesReferencia,
          error: "Sin versiones definidas",
          fuente,
        });
      }
      continue;
    }

    if (conceptErrorByIndicador.has(indicador.id)) {
      const errorMsg = conceptErrorByIndicador.get(indicador.id)!;
      const versionId = versionMap.get(indicador.id)?.id ?? null;
      for (const p of periodos) {
        errores.push({
          indicador_id: indicador.id,
          indicador_nombre: indicador.nombre,
          mes: p.mes,
          error: errorMsg,
        });
        await writeCalcLog({
          indicador_id: indicador.id,
          indicador_version_id: versionId,
          mes_referencia: p.mesReferencia,
          error: errorMsg,
          fuente,
        });
      }
      continue;
    }

    const conceptMap = conceptMapByIndicador.get(indicador.id) ?? null;
    const definicion = definicionMap.get(indicador.id)!;
    const version = versionMap.get(indicador.id)!;

    for (const p of periodos) {
      try {
        const { sql, params } = buildQuery(
          definicion,
          p.inicio,
          p.fin,
          conceptMap,
        );

        await executeAndPersist(
          sql,
          params as Record<string, unknown>,
          version.id,
          p.inicio,
          p.finPersistencia,
          p.mesReferencia,
          { indicadorId: indicador.id, fuente },
        );

        recalculados += 1;
      } catch (err: unknown) {
        const internalMessage =
          err instanceof Error ? err.message : "Error desconocido";
        errores.push({
          indicador_id: indicador.id,
          indicador_nombre: indicador.nombre,
          mes: p.mes,
          error: "Error interno durante el cálculo",
        });
        await writeCalcLog({
          indicador_id: indicador.id,
          indicador_version_id: version.id,
          mes_referencia: p.mesReferencia,
          error: internalMessage,
          fuente,
        });
      }
    }
  }

  return { recalculados, errores, total };
}

// ── Public operations ───────────────────────────────────────────────────

export interface CalcularAhoraResultado extends BatchResult {
  mesReferencia: Date;
}

/**
 * Calculate the current month for every active indicator (month-to-date).
 *
 * The query upper bound is today; the persisted `periodo_fin` is the month
 * end, so the row is labeled as the whole month (see `calcularMesActual`).
 */
export async function calcularAhora(): Promise<CalcularAhoraResultado> {
  const indicadores = await Indicador.findAll({ where: { activo: true } });
  const { inicio, fin, finPersistencia, mes_referencia } = calcularMesActual();

  const periodos: PeriodoCalculo[] = [
    {
      anio: mes_referencia.getUTCFullYear(),
      mes: mes_referencia.getUTCMonth() + 1,
      inicio,
      fin,
      finPersistencia,
      mesReferencia: mes_referencia,
    },
  ];

  const res = await runBatch(indicadores, periodos, "calcular-ahora");
  return { ...res, mesReferencia: mes_referencia };
}

export interface RecalcularAnioResultado extends BatchResult {
  meses_procesados: number;
}

/**
 * Recalculate every month of a year (up to the current month for the current
 * year) for the given indicators.
 */
export async function recalcularAnio(
  indicadores: Indicador[],
  anio: number,
): Promise<RecalcularAnioResultado> {
  const hoy = new Date();
  const currentYear = hoy.getUTCFullYear();
  const currentMonth = hoy.getUTCMonth() + 1;
  const maxMes = anio === currentYear ? currentMonth : 12;

  const periodos: PeriodoCalculo[] = [];
  for (let mes = 1; mes <= maxMes; mes++) {
    const { inicio, fin, mes_referencia } = calcularMesEspecifico(anio, mes);
    periodos.push({
      anio,
      mes,
      inicio,
      fin,
      finPersistencia: fin,
      mesReferencia: mes_referencia,
    });
  }

  const res = await runBatch(indicadores, periodos, "recalcular-anio");
  return { ...res, meses_procesados: periodos.length };
}

export interface ProgramadoResultado extends BatchResult {
  /** Periods actually calculated, as `YYYY-MM`. */
  periodos: string[];
}

/** Build a full-month PeriodoCalculo for `anio`/`mes`. */
function periodoDeMes(anio: number, mes: number): PeriodoCalculo {
  const { inicio, fin, mes_referencia } = calcularMesEspecifico(anio, mes);
  return {
    anio,
    mes,
    inicio,
    fin,
    finPersistencia: fin,
    mesReferencia: mes_referencia,
  };
}

const etiquetaMes = (p: PeriodoCalculo): string =>
  `${p.anio}-${String(p.mes).padStart(2, "0")}`;

/**
 * Nightly recalculation: a rolling window of the current month plus
 * `ventanaMeses - 1` previous months, for every active indicator.
 *
 * Recomputing the recent closed months absorbs late OpenMRS data entry, and
 * the current month stays fresh for the dashboard (its value is provisional
 * until the month closes).
 *
 * @param referencia - "Now" (injectable for tests).
 * @param ventanaMeses - Window size in months (>= 1).
 */
export async function recalcularProgramado(
  referencia: Date,
  ventanaMeses: number,
): Promise<ProgramadoResultado> {
  const indicadores = await Indicador.findAll({ where: { activo: true } });

  const anio = referencia.getUTCFullYear();
  const mesActual = referencia.getUTCMonth() + 1;

  const periodos: PeriodoCalculo[] = [];
  for (let i = 0; i < ventanaMeses; i++) {
    // Date.UTC normalizes month overflow (e.g. going back past January lands
    // on December of the previous year).
    const d = new Date(Date.UTC(anio, mesActual - 1 - i, 1));
    periodos.push(periodoDeMes(d.getUTCFullYear(), d.getUTCMonth() + 1));
  }
  periodos.sort((a, b) => a.inicio.getTime() - b.inicio.getTime());

  const res = await runBatch(indicadores, periodos, "scheduler");

  logger.info("Recálculo programado ejecutado", {
    periodos: periodos.length,
    recalculados: res.recalculados,
    errores: res.errores.length,
    total: res.total,
  });

  return { ...res, periodos: periodos.map(etiquetaMes) };
}

/**
 * Startup catch-up: recalculate every month of the current year (through the
 * previous one) that still lacks canonical coverage, for all active
 * indicators. Fills gaps left by downtime or by indicators created mid-year.
 *
 * @param referencia - "Now" (injectable for tests).
 */
export async function catchupAnio(
  referencia: Date,
): Promise<ProgramadoResultado> {
  const anio = referencia.getUTCFullYear();
  const mesActual = referencia.getUTCMonth() + 1;

  // In January there are no closed months of the current year yet.
  if (mesActual <= 1) {
    return { recalculados: 0, errores: [], total: 0, periodos: [] };
  }

  const indicadores = await Indicador.findAll({ where: { activo: true } });
  const faltantes = await findMesesFaltantes(anio, mesActual - 1);
  faltantes.sort((a, b) => a.mes - b.mes);

  const periodos = faltantes.map((f) => periodoDeMes(f.anio, f.mes));
  const res = await runBatch(indicadores, periodos, "scheduler-catchup");

  logger.info("Catch-up de recálculo ejecutado", {
    periodos: periodos.length,
    recalculados: res.recalculados,
    errores: res.errores.length,
    total: res.total,
  });

  return { ...res, periodos: periodos.map(etiquetaMes) };
}

// ── Catch-up helper ─────────────────────────────────────────────────────

/**
 * Months (January..`hastaMes` of `anio`) for which at least one active
 * indicator lacks a canonical result row. Bounded to a single year.
 */
async function findMesesFaltantes(
  anio: number,
  hastaMes: number,
): Promise<Array<{ anio: number; mes: number }>> {
  const ini = `${anio}-01-01`;
  const fin = `${anio}-${String(hastaMes).padStart(2, "0")}-01`;

  const rows = await sequelize.query<{ mes_referencia: string | Date }>(
    `SELECT gs.mes::date AS mes_referencia
     FROM generate_series(:ini::date, :fin::date, interval '1 month') AS gs(mes)
     WHERE EXISTS (
       SELECT 1 FROM indicador i
       WHERE i.activo = true
         AND NOT EXISTS (
           SELECT 1 FROM indicador_resultado ir
           JOIN indicador_version iv ON iv.id = ir.indicador_version_id
           WHERE iv.indicador_id = i.id
             AND ir.es_canonico = true
             AND ir.mes_referencia = gs.mes::date
         )
     )
     ORDER BY 1`,
    { replacements: { ini, fin }, type: QueryTypes.SELECT },
  );

  return rows.map((row) => {
    const d =
      typeof row.mes_referencia === "string"
        ? new Date(row.mes_referencia)
        : row.mes_referencia;
    return { anio: d.getUTCFullYear(), mes: d.getUTCMonth() + 1 };
  });
}
