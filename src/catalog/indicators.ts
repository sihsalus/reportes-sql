/**
 * Official indicator catalog — registered on every service startup.
 *
 * Each entry is registered as-is: indicador + version 1 with its complete
 * definition, immediately ready to calculate (calcular-ahora and
 * recalcular-anio always take each indicator's latest version).
 *
 * To add an indicator, append an entry to INDICATOR_CATALOG with its
 * canonical definition (the same shape accepted by POST /indicadores)
 * and restart the service.
 *
 * Idempotent, conservative semantics:
 * - matching is by `nombre` (natural key);
 * - an existing indicador is NEVER modified — only missing ones are created;
 * - version 1 is created only when the indicador has no versions yet.
 *   Definition changes to an existing indicador keep going through the
 *   versioning API, never through this catalog.
 */

import { Indicador, IndicadorVersion } from "../models/indicador.js";
import type { DefinicionIndicador } from "../types/definicion.js";
import { OpenMRSUnavailableError } from "../validators/openmrs.js";
import {
  createIndicatorWithVersion,
  createIndicatorVersion,
  parseRegistrationDefinition,
  validateRegistrationUuids,
} from "../indicators/registration.js";

export interface CatalogEntry {
  nombre: string;
  descripcion: string | null;
  /** Complete definition — validated on registration. */
  definicion: unknown;
  activo?: boolean;
}

export interface RegisterIndicatorResult {
  nombre: string;
  indicatorCreated: boolean;
  versionCreated: boolean;
  indicadorId: string;
}

/**
 * Official catalog. Example with a complete definition (population + event):
 *
 * {
 *   nombre: "Diarrea en menores de 5 años",
 *   descripcion: "Atenciones por diarrea en menores de 5 años.",
 *   definicion: {
 *     tipo: "conteo_atenciones",
 *     poblacion: { max_anios_excl: 5 },
 *     evento: { location_uuids: ["<uuid-del-establecimiento>"] },
 *   },
 *   activo: true,
 * },
 */
export const INDICATOR_CATALOG: CatalogEntry[] = [
  {
    nombre: "seed/default-indicator",
    descripcion: "Auto-seeded default indicator for bootstrap/testing.",
    definicion: {
      tipo: "conteo_atenciones",
    },
    activo: true,
  },
  {
    // 3331101 — Caso tratado: atención de menores de 5 años con diagnóstico
    // de IRA no complicada (CIE-10 J00.X, J04.0-J04.2, J06.0, J06.8-J06.9,
    // J20.9, tipo definitivo), atendida en UPSS Consulta Externa.
    nombre: "Infección respiratoria aguda (IRA) no complicada en menores de 5 años",
    descripcion:
      "Sumatoria mensual de atenciones ambulatorias de menores de 5 años con diagnóstico definitivo de IRA no complicada (J00.X, J04.0, J04.1, J04.2, J06.0, J06.8, J06.9, J20.9). Fuente: HIS MINSA.",
    definicion: {
      tipo: "conteo_atenciones",
      poblacion: { max_anios_excl: 5 },
      evento: {
        location_uuids: ["35d2234e-129a-4c40-abb2-1ae0b2400001"],
        diagnosticos: [
          {
            concepto_uuids: [
              "608a5958-7c4c-42db-8a1c-094761a70f26", // J00.X RINOFARINGITIS AGUDA
              "d55a179d-86fb-4b72-8808-824d28288ead", // J04.0 LARINGITIS AGUDA
              "1b19caf0-4bd3-4d0c-9277-cd6c9be636bb", // J04.1 TRAQUEITIS AGUDA
              "1b719d74-8318-4350-b2ba-bc301cd62a7d", // J04.2 LARINGOTRAQUEITIS AGUDA
              "b4bb0bc8-4eb8-4bb9-b8f3-983bd97dbcdb", // J06.0 LARINGOFARINGITIS AGUDA
              "e65af4e3-be05-4ac7-b703-fef24c2a4230", // J06.8 FARINGO AMIGDALITIS AGUDA
              "ae96015f-3a89-484c-bccd-5309b26bdcdb", // J06.9 INFECCION AGUDA VAS NO ESPECIFICADA
              "e01f5787-6897-4447-9879-9eaad59e6d35", // J20.9 BRONQUITIS AGUDA NO ESPECIFICADA
            ],
            tipo_diagnostico: "definitivo",
          },
        ],
      },
    },
    activo: true,
  },
];

/**
 * Registers one catalog entry (indicador + version 1).
 * Never modifies an existing indicador or its versions.
 *
 * On the write path, the definition is validated against OpenMRS with the
 * same validators as POST /indicadores (plus the diagnosticos check).
 * Any unknown UUID — or an unreachable OpenMRS — aborts startup with an
 * error: better not to boot than to permanently register an indicator
 * that silently computes 0. Existing rows are never validated nor touched.
 */
export async function ensureCatalogIndicator(
  entry: CatalogEntry,
): Promise<RegisterIndicatorResult> {
  // Local parse (no I/O): a malformed definition always aborts.
  let definicion: DefinicionIndicador;
  try {
    definicion = parseRegistrationDefinition(entry.definicion);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Catálogo: no se pudo registrar "${entry.nombre}": ${message}. ` +
        `Arranque frenado.`,
    );
  }

  let indicador = await Indicador.findOne({
    where: { nombre: entry.nombre },
  });

  const existingVersion = indicador
    ? await IndicadorVersion.findOne({
        where: {
          indicador_id: indicador.id,
          version: 1,
        },
      })
    : null;

  // Nothing to write → OpenMRS is not even queried: daily startup does
  // not depend on it. OpenMRS validation runs only on the write path,
  // before the first row, so no half-registered rows are ever left behind.
  if (!indicador || !existingVersion) {
    try {
      await validateRegistrationUuids(definicion);
    } catch (err: unknown) {
      if (err instanceof OpenMRSUnavailableError) {
        throw new Error(
          `Catálogo: no se pudo registrar "${entry.nombre}": OpenMRS no disponible. ` +
            `Arranque frenado para no registrar sin validar.`,
        );
      }
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Catálogo: no se pudo registrar "${entry.nombre}": ${message}. ` +
          `Arranque frenado.`,
      );
    }
  }

  let indicatorCreated = false;
  if (!indicador) {
    ({ indicador } = await createIndicatorWithVersion({
      nombre: entry.nombre,
      descripcion: entry.descripcion,
      activo: entry.activo ?? true,
      definicion,
    }));
    indicatorCreated = true;
    return {
      nombre: entry.nombre,
      indicatorCreated,
      versionCreated: true,
      indicadorId: indicador.id,
    };
  }

  let versionCreated = false;
  if (!existingVersion) {
    await createIndicatorVersion(indicador.id, 1, definicion);
    versionCreated = true;
  }

  return {
    nombre: entry.nombre,
    indicatorCreated,
    versionCreated,
    indicadorId: indicador.id,
  };
}

/**
 * Verifies the whole catalog, registering whatever is missing.
 * An invalid definition aborts startup (throw) so the service is never
 * left half-registered — fix the entry and restart.
 */
export async function registerIndicatorCatalog(
  catalog: CatalogEntry[] = INDICATOR_CATALOG,
): Promise<RegisterIndicatorResult[]> {
  const results: RegisterIndicatorResult[] = [];
  for (const entry of catalog) {
    results.push(await ensureCatalogIndicator(entry));
  }
  return results;
}
