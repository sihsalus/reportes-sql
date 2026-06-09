/**
 * Query executor — runs MySQL read-only queries and persists results to PostgreSQL.
 *
 * This module is the bridge between the SQL builder and the database layer.
 * It executes parameterized queries against the OpenMRS MySQL database and
 * stores calculated results (IndicadorResultado rows) in the local PostgreSQL
 * indicators database.
 *
 * Results are stored with `mes_referencia` and `es_canonico` flags. On a
 * successful run for the same indicator version + month, previous canonical
 * rows are superseded and the new row becomes canonical.
 */

import { sequelize } from "../database/postgres.js";
import { getMysqlPool } from "../database/mysql.js";
import { IndicadorResultado } from "../models/indicador.js";
import { QueryTypes } from "sequelize";

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
 * @returns The list of persisted IndicadorResultado instances.
 */
export async function executeAndPersist(
  querySql: string,
  params: Record<string, unknown>,
  indicadorVersionId: string,
  periodoInicio: Date,
  periodoFin: Date,
  mesReferencia?: Date,
): Promise<IndicadorResultado[]> {
  const pool = getMysqlPool();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [rows] = await (pool as any).query({
    sql: querySql,
    namedPlaceholders: true,
    values: params,
  }) as [Array<{ valor: number | string }>, unknown];

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

  // ── Canonical upsert in transaction ──
  if (results.length > 0) {
    const tx = await sequelize.transaction();
    try {
      if (mesReferencia) {
        // Supersede previous canonical rows for same version + month
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

  return results;
}
