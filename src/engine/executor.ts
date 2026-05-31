/**
 * Query executor — runs MySQL read-only queries and persists results to PostgreSQL.
 *
 * This module is the bridge between the SQL builder and the database layer.
 * It executes parameterized queries against the OpenMRS MySQL database and
 * stores calculated results (IndicadorResultado rows) in the local PostgreSQL
 * indicators database.
 */

import { getMysqlPool } from "../database/mysql.js";
import { IndicadorResultado } from "../models/indicador.js";

/**
 * Execute a read-only MySQL query and persist each result row to PostgreSQL.
 *
 * @param querySql - Parameterized SQL string (uses :name syntax for mysql2).
 * @param params - Parameter values keyed by name.
 * @param indicadorVersionId - Which IndicadorVersion these results belong to.
 * @param periodoInicio - Start date of the calculation period.
 * @param periodoFin - End date of the calculation period.
 * @returns The list of persisted IndicadorResultado instances.
 */
export async function executeAndPersist(
  querySql: string,
  params: Record<string, unknown>,
  indicadorVersionId: string,
  periodoInicio: Date,
  periodoFin: Date,
): Promise<IndicadorResultado[]> {
  const pool = getMysqlPool();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [rows] = await (pool as any).query({
    sql: querySql,
    namedPlaceholders: true,
    values: params,
  }) as [Array<{ valor: number | string }>, unknown];

  // ── 2. Build and persist ORM instances ──
  const now = new Date();
  const resultados: IndicadorResultado[] = [];

  for (const row of rows) {
    const valor = typeof row.valor === "string" ? parseFloat(row.valor) : row.valor;
    if (valor == null || isNaN(valor)) continue;

    resultados.push(
      IndicadorResultado.build({
        indicador_version_id: indicadorVersionId,
        periodo_inicio: periodoInicio,
        periodo_fin: periodoFin,
        valor,
        calculado_en: now,
      }),
    );
  }

  // ── 3. Persist to PostgreSQL ──
  if (resultados.length > 0) {
    await IndicadorResultado.bulkCreate(
      resultados.map((r) => r.toJSON()),
      { validate: true },
    );
  }

  return resultados;
}
