/**
 * OpenMRS sync validators — existence checks against the external OpenMRS database.
 *
 * Design decision: keep I/O out of Zod schemas. Format validation happens
 * in DefinicionIndicadorSchema (Zod), existence checks happen here (router-level),
 * keeping schemas side-effect-free and testable in isolation.
 */

import { getMysqlPool } from "../database/mysql.js";
import type { DefinicionIndicador } from "../types/definicion.js";

/**
 * Validate all UUID strings exist in the OpenMRS location table.
 *
 * Queries the sync MySQL database with a single parameterized SELECT
 * to avoid N+1 queries.
 *
 * @param uuids - Set of UUID strings to validate.
 * @returns Array of unknown UUIDs. Empty array means all valid.
 * @throws Error with message "OpenMRS no disponible" on MySQL connection failure.
 */
export async function validarLocations(
  uuids: Set<string>,
): Promise<string[]> {
  if (uuids.size === 0) return [];

  const pool = getMysqlPool();

  try {
    const uuidArray = Array.from(uuids);
    const placeholders = uuidArray.map((_, i) => `:uuid_${i}`).join(", ");
    const params: Record<string, string> = {};
    uuidArray.forEach((u, i) => {
      params[`uuid_${i}`] = u;
    });

    const [rows] = await (pool as any).query({
      sql: `SELECT uuid FROM location WHERE uuid IN (${placeholders})`,
      namedPlaceholders: true,
      values: params,
    }) as [Array<{ uuid: string }>, unknown];

    const encontrados = new Set(rows.map((r) => r.uuid));
    const desconocidos = uuidArray.filter((u) => !encontrados.has(u));

    return desconocidos;
  } catch (err: unknown) {
    throw new Error("OpenMRS no disponible");
  }
}

/**
 * Collect unique location_uuids from the singular evento and validate.
 *
 * Convenience helper that extracts UUIDs from a definicion and passes
 * them to validarLocations() in a single call.
 *
 * @param definicion - Fully validated DefinicionIndicador.
 * @returns Array of unknown UUIDs, empty if all valid.
 */
export async function validarDefinicionLocationUuids(
  definicion: DefinicionIndicador,
): Promise<string[]> {
  const allUuids = new Set<string>();
  if (definicion.evento?.location_uuids) {
    for (const u of definicion.evento.location_uuids) {
      allUuids.add(u);
    }
  }
  return validarLocations(allUuids);
}

/**
 * Resolve ordenes concepto UUIDs to OpenMRS concept_ids.
 *
 * Queries the OpenMRS MySQL concept table to map concepto_uuid strings
 * to their numeric concept_id. Only returns non-retired concepts.
 *
 * @param uuids - Array of concepto UUID strings to resolve.
 * @returns Mapping from concepto_uuid string to concept_id number.
 */
export async function resolveConceptMap(
  uuids: string[],
): Promise<Record<string, number>> {
  if (uuids.length === 0) return {};

  const pool = getMysqlPool();

  try {
    const placeholders = uuids.map((_, i) => `:uuid_${i}`).join(", ");
    const params: Record<string, string> = {};
    uuids.forEach((u, i) => {
      params[`uuid_${i}`] = u;
    });

    const [rows] = await (pool as any).query({
      sql: `SELECT uuid, concept_id FROM concept WHERE uuid IN (${placeholders}) AND retired = 0`,
      namedPlaceholders: true,
      values: params,
    }) as [Array<{ uuid: string; concept_id: number }>, unknown];

    const result: Record<string, number> = {};
    for (const row of rows) {
      result[row.uuid] = row.concept_id;
    }
    return result;
  } catch {
    return {};
  }
}
