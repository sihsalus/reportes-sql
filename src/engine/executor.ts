/**
 * Query executor — runs MySQL read-only queries and persists results to PostgreSQL.
 *
 * This module is the bridge between the SQL builder and the database layer.
 * It executes parameterized queries against the OpenMRS MySQL database and
 * stores calculated results (IndicadorResultado rows) in the local PostgreSQL
 * indicators database.
 *
 * Results are stored with `mes_referencia` and `es_canonico` flags. On a
 * successful run for the same indicator + month, previous canonical rows are
 * superseded and the new row becomes canonical. When the caller identifies
 * the indicator (via `opts.indicadorId`), supersede crosses versions, so a
 * recalculation after a definition change never leaves two canonical rows
 * for the same indicator + month.
 *
 * Every execution attempt is recorded in `indicador_calculo_log`
 * (IndicadorCalculoLog) with status 'success' or 'error'.
 */

import { sequelize } from "../database/postgres.js";
import { queryMysql } from "../database/mysql.js";
import { IndicadorResultado, IndicadorCalculoLog } from "../models/indicador.js";
import { QueryTypes } from "sequelize";
import { logger } from "../config/logger.js";

/** Extra execution options passed by callers that know the indicator context. */
export interface ExecuteAndPersistOpts {
  /** Indicator id — enables cross-version canonical supersede. */
  indicadorId?: string;
  /** Origin label for the ledger (e.g. 'calcular-ahora', 'recalcular-anio'). */
  fuente?: string;
  /** Persist a 0-valued canonical row when MySQL returns no rows for a month. */
  persistirCeroSiVacio?: boolean;
}

/** Render a Date as a YYYY-MM-DD day (mes_referencia is a day, not a timestamp). */
function formatDia(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Best-effort ledger write — must NEVER fail the calculation that triggered it.
 */
async function tryWriteCalculoLog(entry: {
  status: string;
  indicador_id: string | null;
  indicador_version_id: string;
  mes_referencia: Date | null;
  filas_devueltas: number | null;
  filas_persistidas: number | null;
  duracion_ms: number;
  error: string | null;
  fuente: string | null;
}): Promise<void> {
  try {
    await IndicadorCalculoLog.create({
      ...entry,
      creado_en: new Date(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn("Failed to write indicador_calculo_log entry", { error: message });
  }
}

/**
 * Execute a read-only MySQL query and persist each result row to PostgreSQL
 * with canonical monthly semantics.
 *
 * @param querySql - Parameterized SQL string (uses :name syntax for mysql2).
 * @param params - Parameter values keyed by name.
 * @param indicadorVersionId - Which IndicadorVersion these results belong to.
 * @param periodoInicio - Start date of the calculation period.
 * @param periodoFin - End date of the calculation period.
 * @param mesReferencia - Canonical month reference (first day of month).
 * @param opts - Optional execution context (indicator id, ledger source, zero-fill).
 * @returns The list of persisted IndicadorResultado instances.
 */
export async function executeAndPersist(
  querySql: string,
  params: Record<string, unknown>,
  indicadorVersionId: string,
  periodoInicio: Date,
  periodoFin: Date,
  mesReferencia?: Date,
  opts: ExecuteAndPersistOpts = {},
): Promise<IndicadorResultado[]> {
  const t0 = Date.now();

  const ledgerBase = {
    indicador_id: opts.indicadorId ?? null,
    indicador_version_id: indicadorVersionId,
    mes_referencia: mesReferencia ?? null,
    fuente: opts.fuente ?? null,
  };

  try {
    const rows = await queryMysql<{ valor: number | string }>(querySql, params);

    const now = new Date();
    const results: IndicadorResultado[] = [];

    for (const row of rows) {
      const valor = typeof row.valor === "string" ? parseFloat(row.valor) : row.valor;
      if (valor == null || isNaN(valor)) continue;

      results.push(
        IndicadorResultado.build({
          indicador_version_id: indicadorVersionId,
          periodo_inicio: periodoInicio,
          periodo_fin: periodoFin,
          valor,
          calculado_en: now,
          mes_referencia: mesReferencia ?? null,
          es_canonico: Boolean(mesReferencia),
        }),
      );
    }

    // A month that yields no rows is still a computed month: persist 0 so it
    // is distinguishable from a never-calculated month in series/views.
    if (results.length === 0 && opts.persistirCeroSiVacio && mesReferencia) {
      results.push(
        IndicadorResultado.build({
          indicador_version_id: indicadorVersionId,
          periodo_inicio: periodoInicio,
          periodo_fin: periodoFin,
          valor: 0,
          calculado_en: now,
          mes_referencia: mesReferencia,
          es_canonico: true,
        }),
      );
    }

    // ── Canonical upsert in transaction ──
    if (results.length > 0) {
      const tx = await sequelize.transaction();
      try {
        if (mesReferencia) {
          if (opts.indicadorId) {
            // Cross-version supersede: a version change must not leave two
            // canonical rows for the same indicator + month.
            await sequelize.query(
              `UPDATE indicador_resultado ir
               SET es_canonico = false
               FROM indicador_version iv
               WHERE ir.indicador_version_id = iv.id
                 AND iv.indicador_id = :indicador_id
                 AND ir.mes_referencia = :mes_referencia
                 AND ir.es_canonico = true`,
              {
                replacements: {
                  indicador_id: opts.indicadorId,
                  mes_referencia: formatDia(mesReferencia),
                },
                transaction: tx,
                type: QueryTypes.UPDATE,
              },
            );
          } else {
            // Legacy: supersede canonical rows for the same version + month.
            await IndicadorResultado.update(
              { es_canonico: false },
              {
                where: {
                  indicador_version_id: indicadorVersionId,
                  mes_referencia: mesReferencia,
                  es_canonico: true,
                },
                transaction: tx,
              },
            );
          }
        }

        await IndicadorResultado.bulkCreate(
          results.map((r) => r.toJSON()),
          { validate: true, transaction: tx },
        );

        await tx.commit();
      } catch (err) {
        await tx.rollback();
        throw err;
      }
    }

    await tryWriteCalculoLog({
      ...ledgerBase,
      status: "success",
      filas_devueltas: rows.length,
      filas_persistidas: results.length,
      duracion_ms: Date.now() - t0,
      error: null,
    });

    return results;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await tryWriteCalculoLog({
      ...ledgerBase,
      status: "error",
      filas_devueltas: null,
      filas_persistidas: null,
      duracion_ms: Date.now() - t0,
      error: message,
    });
    throw err;
  }
}
