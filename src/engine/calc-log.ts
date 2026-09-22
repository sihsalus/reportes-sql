/**
 * Best-effort ledger writer for `indicador_calculo_log`.
 *
 * Three callers (executor, resultados, recalcular-anio) previously each
 * carried a near-identical try/catch around `IndicadorCalculoLog.create`.
 * This module unifies them: a single `writeCalcLog(entry)` that builds the
 * row, writes it, and NEVER throws — a ledger failure must not mask the
 * calculation that triggered it.
 *
 * The entry is the union of the three previous signatures. Callers that
 * only log errors may omit the success-only fields (status, filas_*,
 * duracion_ms); they default to the same values the old error helpers
 * hard-coded ("error" / null).
 */

import { IndicadorCalculoLog } from "../models/indicador.js";
import { logger } from "../config/logger.js";

/**
 * Normalized ledger entry. The identity fields (indicador_id,
 * indicador_version_id, mes_referencia, error, fuente) are required; the
 * success-only fields default so error-only callers keep their old shape.
 */
export interface CalcLogEntry {
  /** Indicator id — null when the caller has no indicator context. */
  indicador_id: string | null;
  /** IndicadorVersion id — null for the no-version error path. */
  indicador_version_id: string | null;
  /** Canonical month reference (first day of month), or null. */
  mes_referencia: Date | null;
  /** Error message for status "error"; null for status "success". */
  error: string | null;
  /** Origin label (e.g. 'calcular-ahora', 'recalcular-anio'). */
  fuente: string | null;
  /** Ledger status — defaults to "error" when omitted. */
  status?: string;
  /** Rows returned by MySQL — defaults to null. */
  filas_devueltas?: number | null;
  /** Rows persisted to PostgreSQL — defaults to null. */
  filas_persistidas?: number | null;
  /** Execution duration in ms — defaults to null. */
  duracion_ms?: number | null;
}

/**
 * Write a single `indicador_calculo_log` row. Never throws: on failure the
 * error is logged as a warning and swallowed so the caller's calculation is
 * not masked by a ledger write error.
 */
export async function writeCalcLog(entry: CalcLogEntry): Promise<void> {
  try {
    await IndicadorCalculoLog.create({
      status: entry.status ?? "error",
      indicador_id: entry.indicador_id,
      indicador_version_id: entry.indicador_version_id,
      mes_referencia: entry.mes_referencia,
      filas_devueltas: entry.filas_devueltas ?? null,
      filas_persistidas: entry.filas_persistidas ?? null,
      duracion_ms: entry.duracion_ms ?? null,
      error: entry.error,
      fuente: entry.fuente,
      creado_en: new Date(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn("Failed to write indicador_calculo_log entry", { error: message });
  }
}