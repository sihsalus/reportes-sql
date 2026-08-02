/**
 * Shared helper: resolve OpenMRS concept UUIDs from ordenes filters into
 * a conceptMap (uuid → concept_id) suitable for buildQuery.
 *
 * Used by calcular-ahora and preview-sql to avoid duplicating the
 * resolve → map → missing-validation pattern.
 *
 * Failures are loud and differentiated:
 * - OpenMRS unreachable → OpenMRSUnavailableError (routers map to 502)
 * - UUIDs absent from OpenMRS → Error listing the missing UUIDs (422)
 */

import type { FiltroOrden } from "../types/definicion.js";
import {
  resolveConceptMap,
  OpenMRSUnavailableError,
} from "../validators/openmrs.js";

export async function resolveOrcenesConceptMap(
  ordenes: FiltroOrden[] | null | undefined,
): Promise<Record<string, number> | null> {
  if (!ordenes || ordenes.length === 0) return null;

  const uuids = ordenes.map((f) => f.concepto_uuid);

  let resolved: Record<string, number>;
  try {
    resolved = await resolveConceptMap(uuids);
  } catch {
    throw new OpenMRSUnavailableError();
  }

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
