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
import { IndicadorResultado } from "../models/indicador.js";
import { QueryTypes } from "sequelize";
import { writeCalcLog } from "./calc-log.js";

/** Extra execution options passed by callers that know the indicator context. */
export interface ExecuteAndPersistOpts {
  /** Indicator id — enables cross-version canonical supersede. */
  indicadorId?: string;
  /** Origin label for the ledger (e.g. 'calcular-ahora', 'recalcular-anio'). */
  fuente?: string;
  /** Persist a 0-valued canonical row when MySQL returns no rows for a month. */
  persistirCeroSiVacio?: boolean;
}

/**
 * Render a Date as a YYYY-MM-DD day (DATEONLY columns are days, not timestamps).
 *
 * All persisted day values (periodo_inicio, periodo_fin, mes_referencia) MUST
 * go through this helper instead of passing Date objects to Sequelize.
 * Rationale: `Sequelize.DATEONLY` stringifies Date objects with
 * `moment(date).format('YYYY-MM-DD')` in the process LOCAL timezone, while the
 * canonical supersede UPDATE below matches on this UTC rendering. With a
 * non-UTC server timezone (e.g. America/Lima) `Date.UTC(2026,7,1)` would be
 * stored as '2026-07-31' but superseded as '2026-08-01' — the UPDATE would
 * match 0 rows and every recalculation would add another canonical row.
 */
function formatDia(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** True when the error is a Sequelize unique-constraint violation. */
function isUniqueViolation(err: unknown): boolean {
  return (
    err != null &&
    typeof err === "object" &&
    (err as { name?: unknown }).name === "SequelizeUniqueConstraintError"
  );
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
    // Normalize every DATEONLY value to a UTC YYYY-MM-DD string (see
    // formatDia). Never pass Date objects for these columns: Sequelize would
    // stringify them in local time and diverge from the supersede predicate.
    const diaInicio = formatDia(periodoInicio);
    const diaFin = formatDia(periodoFin);
    const diaMes = mesReferencia ? formatDia(mesReferencia) : null;
    const results: IndicadorResultado[] = [];

    for (const row of rows) {
      const valor = typeof row.valor === "string" ? parseFloat(row.valor) : row.valor;
      if (valor == null || isNaN(valor)) continue;

      results.push(
        IndicadorResultado.build({
          indicador_version_id: indicadorVersionId,
          // Casts: DATEONLY columns accept YYYY-MM-DD strings at runtime;
          // the casts only silence the Date-typed model declarations.
          periodo_inicio: diaInicio as unknown as Date,
          periodo_fin: diaFin as unknown as Date,
          valor,
          calculado_en: now,
          mes_referencia: diaMes as unknown as Date | null,
          es_canonico: diaMes != null,
        }),
      );
    }

    // A month that yields no rows is still a computed month: persist 0 so it
    // is distinguishable from a never-calculated month in series/views.
    if (results.length === 0 && opts.persistirCeroSiVacio && diaMes != null) {
      results.push(
        IndicadorResultado.build({
          indicador_version_id: indicadorVersionId,
          periodo_inicio: diaInicio as unknown as Date,
          periodo_fin: diaFin as unknown as Date,
          valor: 0,
          calculado_en: now,
          mes_referencia: diaMes as unknown as Date,
          es_canonico: true,
        }),
      );
    }

    // ── Canonical upsert in transaction ──
    // Retried once on unique violation: two concurrent recalculations of the
    // same month (e.g. double-clicking "calcular año") can both pass the
    // supersede UPDATE before either inserts. The partial unique index
    // (uq_resultado_version_mes_canonico) rejects the loser; the retry then
    // supersedes the winner and inserts exactly one canonical row.
    if (results.length > 0) {
      const payloads = results.map((r) => r.toJSON());
      let attempt = 0;
      for (;;) {
        const tx = await sequelize.transaction();
        try {
          if (diaMes != null) {
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
                    mes_referencia: diaMes,
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
                    mes_referencia: diaMes,
                    es_canonico: true,
                  },
                  transaction: tx,
                },
              );
            }
          }

          await IndicadorResultado.bulkCreate(payloads, {
            validate: true,
            transaction: tx,
          });

          await tx.commit();
          break;
        } catch (err) {
          await tx.rollback();
          if (attempt === 0 && isUniqueViolation(err)) {
            attempt += 1;
            continue;
          }
          throw err;
        }
      }
    }

    await writeCalcLog({
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
    await writeCalcLog({
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
