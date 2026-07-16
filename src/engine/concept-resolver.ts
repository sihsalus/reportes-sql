/**
 * Shared helper: resolve OpenMRS concept UUIDs from ordenes filters into
 * a conceptMap (uuid → concept_id) suitable for buildQuery.
 *
 * Used by calcular-ahora, recalcular-anio, and preview-sql to avoid
 * duplicating the resolve → map → missing-validation pattern.
 */

import type { FiltroOrden } from "../types/definicion.js";
import { resolveConceptMap } from "../validators/openmrs.js";

export async function resolveOrcenesConceptMap(
  ordenes: FiltroOrden[] | null | undefined,
): Promise<Record<string, number> | null> {
  if (!ordenes || ordenes.length === 0) return null;

  const uuids = ordenes.map((f) => f.concepto_uuid);
  const resolved = await resolveConceptMap(uuids);

  const conceptMap: Record<string, number> = {};
  const missing: string[] = [];

  for (const f of ordenes) {
    const cid = resolved[f.concepto_uuid];
    if (cid !== undefined) {
      conceptMap[f.concepto_uuid] = cid;
    } else {
      missing.push(f.concepto_uuid);
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `Conceptos de órdenes no encontrados: ${missing.join(", ")}`,
    );
  }

  return conceptMap;
}

/**
 * Non-throwing variant used by preview-sql which silently skips ordenes
 * when concept resolution fails.
 */
export async function resolveOrcenesConceptMapOrNull(
  ordenes: FiltroOrden[] | null | undefined,
): Promise<Record<string, number> | null> {
  try {
    return await resolveOrcenesConceptMap(ordenes);
  } catch {
    return null;
  }
}
