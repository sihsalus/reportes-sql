/**
 * Single source of truth for "the latest version of an indicator".
 *
 * Previously four call sites reimplemented this lookup with subtly different
 * filters (an ORM `findAll` + in-JS reduce, a raw `DISTINCT ON`, and two raw
 * `ORDER BY version DESC LIMIT 1` variants). They now share these two queries
 * so a change of criterion cannot silently apply to only some of them.
 */

import { QueryTypes } from "sequelize";
import { sequelize } from "../database/postgres.js";

/** The newest version of an indicator, with its definition loaded. */
export interface LatestVersion {
  id: string;
  version: number;
  definicion: Record<string, unknown>;
}

/**
 * Latest version of a single indicator, or null when it has none.
 *
 * `requireActive` reproduces the pre-existing filters: `/metas` and
 * `/resultados/series` hide versions of deactivated indicators, while the SQL
 * preview reads the newest version regardless of `activo` (its indicator was
 * already resolved by id).
 */
export async function findLatestVersion(
  indicadorId: string,
  requireActive: boolean,
): Promise<LatestVersion | null> {
  // Static fragment only — never user input.
  const activeClause = requireActive ? "AND i.activo = true" : "";
  const rows = await sequelize.query<LatestVersion>(
    `SELECT iv.id, iv.version, iv.definicion
     FROM indicador_version iv
     JOIN indicador i ON i.id = iv.indicador_id
     WHERE iv.indicador_id = :indicador_id
       ${activeClause}
     ORDER BY iv.version DESC
     LIMIT 1`,
    {
      replacements: { indicador_id: indicadorId },
      type: QueryTypes.SELECT,
    },
  );
  return rows[0] ?? null;
}

/**
 * Latest version per indicator for a batch of ids, keyed by `indicador_id`.
 *
 * One `DISTINCT ON` query instead of one lookup per indicator. Callers pass
 * the indicators they already resolved (active ones, or a single id), so no
 * extra `activo` filter is applied here.
 */
export async function findLatestVersions(
  indicadorIds: string[],
): Promise<Map<string, LatestVersion>> {
  if (indicadorIds.length === 0) return new Map();

  const rows = await sequelize.query<LatestVersion & { indicador_id: string }>(
    `SELECT DISTINCT ON (iv.indicador_id)
       iv.id, iv.indicador_id, iv.version, iv.definicion
     FROM indicador_version iv
     WHERE iv.indicador_id IN (:indicador_ids)
     ORDER BY iv.indicador_id, iv.version DESC`,
    {
      replacements: { indicador_ids: indicadorIds },
      type: QueryTypes.SELECT,
    },
  );

  return new Map(rows.map((row) => [row.indicador_id, row]));
}
