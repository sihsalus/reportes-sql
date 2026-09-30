/**
 * Official indicator catalog — registered on every service startup.
 *
 * The entries live in ./indicators.json (data, not code): adding an
 * indicator means editing that file and restarting the service. Each entry
 * is registered as-is: indicador + version 1 with its complete definition,
 * immediately ready to calculate (calcular-ahora and recalcular-anio always
 * take each indicator's latest version).
 *
 * The file is a JSON array of entries; each `definicion` uses the same
 * canonical shape accepted by POST /indicadores and is validated on
 * registration.
 *
 * Idempotent, conservative semantics:
 * - matching is by `nombre` (natural key);
 * - an existing indicador is NEVER modified — only missing ones are created;
 * - version 1 is created only when the indicador has no versions yet.
 *   Definition changes to an existing indicador keep going through the
 *   versioning API, never through this catalog.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
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
 * Shape of a single entry in ./indicators.json. Strict: unknown keys are
 * rejected so typos surface at startup instead of being silently ignored.
 */
const CatalogEntrySchema = z
  .object({
    nombre: z.string().min(1),
    descripcion: z.string().nullable().default(null),
    definicion: z.unknown(),
    activo: z.boolean().optional(),
  })
  .strict();

const CatalogFileSchema = z.array(CatalogEntrySchema);

/**
 * Candidate locations for the catalog file, resolved against the working
 * directory at call time (there is no module-dir API that works under both
 * the ESM runtime and jest's CJS transform):
 * - `src/catalog/indicators.json` in development (tsx) and under jest;
 * - `dist/catalog/indicators.json` in production, where the image ships only
 *   `dist` (copied by scripts/copy-assets.mjs during `yarn build`).
 */
const CATALOG_CANDIDATES = [
  join(process.cwd(), "src", "catalog", "indicators.json"),
  join(process.cwd(), "dist", "catalog", "indicators.json"),
];

function resolveCatalogPath(): string {
  for (const candidate of CATALOG_CANDIDATES) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return CATALOG_CANDIDATES[0];
}

/**
 * Reads and validates ./indicators.json.
 *
 * Any failure — missing/unreadable file, invalid JSON, wrong shape — aborts
 * startup with a clear message: better not to boot than to register a
 * partial or malformed catalog.
 */
export function loadIndicatorCatalog(): CatalogEntry[] {
  const path = resolveCatalogPath();

  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Catálogo: no se pudo leer ${path}: ${message}. Arranque frenado.`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Catálogo: ${path} no es JSON válido: ${message}. Arranque frenado.`,
    );
  }

  const result = CatalogFileSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `Catálogo: ${path} no tiene el formato esperado: ` +
        `${result.error.message}. Arranque frenado.`,
    );
  }
  return result.data as CatalogEntry[];
}

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
  catalog: CatalogEntry[] = loadIndicatorCatalog(),
): Promise<RegisterIndicatorResult[]> {
  const results: RegisterIndicatorResult[] = [];
  for (const entry of catalog) {
    results.push(await ensureCatalogIndicator(entry));
  }
  return results;
}
