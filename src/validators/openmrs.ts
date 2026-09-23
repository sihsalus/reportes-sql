/**
 * OpenMRS sync validators — existence checks against the external OpenMRS database.
 *
 * Design decision: keep I/O out of Zod schemas. Format validation happens
 * in DefinicionIndicadorSchema (Zod), existence checks happen here (router-level),
 * keeping schemas side-effect-free and testable in isolation.
 */

import { queryMysql } from "../database/mysql.js";
import type { DefinicionIndicador } from "../types/definicion.js";
import { OpenMRSUnavailableError } from "../errors.js";

// Re-export the legacy location so existing imports (`import {
// OpenMRSUnavailableError } from "../validators/openmrs.js"`) keep working.
export { OpenMRSUnavailableError };

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


  try {
    const uuidArray = Array.from(uuids);
    const placeholders = uuidArray.map((_, i) => `:uuid_${i}`).join(", ");
    const params: Record<string, string> = {};
    uuidArray.forEach((u, i) => {
      params[`uuid_${i}`] = u;
    });

    const rows = await queryMysql<{ uuid: string }>(`SELECT uuid FROM location WHERE uuid IN (${placeholders})`, params);

    const encontrados = new Set(rows.map((r) => r.uuid));
    const desconocidos = uuidArray.filter((u) => !encontrados.has(u));

    return desconocidos;
  } catch (err: unknown) {
    throw new OpenMRSUnavailableError();
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
 * Validate all UUID strings exist in the OpenMRS encounter_type table.
 *
 * Queries the sync MySQL database with a single parameterized SELECT
 * to avoid N+1 queries. Retired encounter types are excluded.
 *
 * @param uuids - Set of UUID strings to validate.
 * @returns Array of unknown UUIDs. Empty array means all valid.
 * @throws Error with message "OpenMRS no disponible" on MySQL connection failure.
 */
export async function validarEncounterTypes(
  uuids: Set<string>,
): Promise<string[]> {
  if (uuids.size === 0) return [];

  try {
    const uuidArray = Array.from(uuids);
    const placeholders = uuidArray.map((_, i) => `:uuid_${i}`).join(", ");
    const params: Record<string, string> = {};
    uuidArray.forEach((u, i) => {
      params[`uuid_${i}`] = u;
    });

    const rows = await queryMysql<{ uuid: string }>(
      `SELECT uuid FROM encounter_type WHERE uuid IN (${placeholders}) AND retired = 0`,
      params,
    );

    const encontrados = new Set(rows.map((r) => r.uuid));
    const desconocidos = uuidArray.filter((u) => !encontrados.has(u));

    return desconocidos;
  } catch (err: unknown) {
    throw new OpenMRSUnavailableError();
  }
}

/**
 * Collect unique encounter_type_uuids from the singular evento and validate.
 *
 * Convenience helper that extracts UUIDs from a definicion and passes
 * them to validarEncounterTypes() in a single call.
 *
 * @param definicion - Fully validated DefinicionIndicador.
 * @returns Array of unknown UUIDs, empty if all valid.
 */
export async function validarDefinicionEncounterTypeUuids(
  definicion: DefinicionIndicador,
): Promise<string[]> {
  const allUuids = new Set<string>();
  if (definicion.evento?.encounter_type_uuids) {
    for (const u of definicion.evento.encounter_type_uuids) {
      allUuids.add(u);
    }
  }
  return validarEncounterTypes(allUuids);
}

/**
 * Collect diagnostico + ordenes concepto UUIDs from a definicion and report
 * which ones do not exist (or are retired) in the OpenMRS concept table.
 *
 * The indicator POST route does not check these at creation time (they
 * resolve per calculation instead), but the startup catalog must: a typo'd
 * UUID would otherwise register an indicator that silently computes 0.
 *
 * @param definicion - Fully validated DefinicionIndicador.
 * @returns Array of unknown UUIDs, empty if all valid.
 */
export async function validarDefinicionDiagnosticoUuids(
  definicion: DefinicionIndicador,
): Promise<string[]> {
  const allUuids: string[] = [];
  const seen = new Set<string>();
  const collect = (u: string): void => {
    if (!seen.has(u)) {
      seen.add(u);
      allUuids.push(u);
    }
  };

  for (const d of definicion.evento?.diagnosticos ?? []) {
    for (const u of d.concepto_uuids) collect(u);
  }
  for (const o of definicion.evento?.ordenes ?? []) {
    collect(o.concepto_uuid);
  }

  if (allUuids.length === 0) return [];
  const conceptMap = await resolveConceptMap(allUuids);
  return allUuids.filter((u) => conceptMap[u] === undefined);
}

/** Unknown UUIDs grouped by field — all empty means the definition is valid. */
export interface DefinicionUnknownUuids {
  location_uuids: string[];
  encounter_type_uuids: string[];
  diagnostico_uuids: string[];
}

/**
 * Shared OpenMRS existence check for a full definition.
 *
 * Used by the startup catalog (and available to the indicator routes):
 * every UUID referenced by the definition must exist in OpenMRS, otherwise
 * the indicator would silently compute wrong values. Throws
 * OpenMRSUnavailableError when the MySQL database cannot be reached.
 */
export async function validarDefinicionContraOpenMRS(
  definicion: DefinicionIndicador,
): Promise<DefinicionUnknownUuids> {
  const [location_uuids, encounter_type_uuids, diagnostico_uuids] =
    await Promise.all([
      validarDefinicionLocationUuids(definicion),
      validarDefinicionEncounterTypeUuids(definicion),
      validarDefinicionDiagnosticoUuids(definicion),
    ]);
  return { location_uuids, encounter_type_uuids, diagnostico_uuids };
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


  try {
    const placeholders = uuids.map((_, i) => `:uuid_${i}`).join(", ");
    const params: Record<string, string> = {};
    uuids.forEach((u, i) => {
      params[`uuid_${i}`] = u;
    });

    const rows = await queryMysql<{ uuid: string; concept_id: number }>(`SELECT uuid, concept_id FROM concept WHERE uuid IN (${placeholders}) AND retired = 0`, params);

    const result: Record<string, number> = {};
    for (const row of rows) {
      result[row.uuid] = row.concept_id;
    }
    return result;
  } catch {
    throw new OpenMRSUnavailableError();
  }
}
