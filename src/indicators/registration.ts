/**
 * Shared indicator registration service — single source of truth for
 * creating indicators with version 1.
 *
 * Both POST /indicadores and the startup catalog (src/catalog/) register
 * through these primitives, so validation rules cannot drift between the
 * two write paths. HTTP concerns (status codes, body shapes) stay in the
 * router; thrown errors are typed so callers can map them:
 *
 * - PeriodRejectedError    → 422 { field: "definicion.periodo" }
 * - InvalidDefinitionError  → 422 { field: "definicion" }
 * - UnknownUuidsError   → 422 { field, unknown_uuids }
 * - OpenMRSUnavailableError  → 502 (propagates from the validators)
 */

import { v4 as uuidv4 } from "uuid";
import { Indicador, IndicadorVersion } from "../models/indicador.js";
import {
  parseDefinicionIndicador,
  rejectPeriodoInPayload,
  type DefinicionIndicador,
} from "../types/definicion.js";
import {
  validarDefinicionLocationUuids,
  validarDefinicionEncounterTypeUuids,
  validarDefinicionDiagnosticoUuids,
} from "../validators/openmrs.js";

export class PeriodRejectedError extends Error {
  readonly field = "definicion.periodo" as const;
  constructor(message: string) {
    super(message);
    this.name = "PeriodRejectedError";
  }
}

export class InvalidDefinitionError extends Error {
  readonly field = "definicion" as const;
  constructor(message: string) {
    super(message);
    this.name = "InvalidDefinitionError";
  }
}

export class UnknownUuidsError extends Error {
  constructor(
    readonly field: string,
    readonly unknown_uuids: string[],
  ) {
    super(`UUIDs desconocidos en OpenMRS [${field}]: ${unknown_uuids.join(", ")}`);
    this.name = "UnknownUuidsError";
  }
}

/**
 * Parse a raw definition payload: reject legacy periodo, then validate
 * shape. Throws PeriodRejectedError / InvalidDefinitionError.
 */
export function parseRegistrationDefinition(raw: unknown): DefinicionIndicador {
  try {
    rejectPeriodoInPayload(raw);
  } catch (err: unknown) {
    throw new PeriodRejectedError(
      err instanceof Error ? err.message : "Validation error",
    );
  }
  try {
    return parseDefinicionIndicador(raw);
  } catch (err: unknown) {
    throw new InvalidDefinitionError(
      err instanceof Error ? err.message : "Validation error",
    );
  }
}

/**
 * Existence check of every UUID referenced by the definition.
 * Throws UnknownUuidsError naming the first offending field
 * (locations → encounter types → diagnosticos/ordenes); OpenMRS
 * outages propagate as OpenMRSUnavailableError.
 */
export async function validateRegistrationUuids(
  definicion: DefinicionIndicador,
): Promise<void> {
  const locationUuids = await validarDefinicionLocationUuids(definicion);
  if (locationUuids.length > 0) {
    throw new UnknownUuidsError("location_uuids", locationUuids);
  }
  const encounterTypeUuids =
    await validarDefinicionEncounterTypeUuids(definicion);
  if (encounterTypeUuids.length > 0) {
    throw new UnknownUuidsError(
      "encounter_type_uuids",
      encounterTypeUuids,
    );
  }
  const diagnosticoUuids =
    await validarDefinicionDiagnosticoUuids(definicion);
  if (diagnosticoUuids.length > 0) {
    throw new UnknownUuidsError("diagnosticos", diagnosticoUuids);
  }
}

export interface CreateIndicatorInput {
  nombre: string;
  descripcion: string | null;
  activo: boolean;
  definicion: DefinicionIndicador;
}

/**
 * Persist an indicador with its version 1. No validation — callers run
 * parseRegistrationDefinition + validateRegistrationUuids first.
 */
export async function createIndicatorWithVersion(
  input: CreateIndicatorInput,
): Promise<{ indicador: Indicador; version: IndicadorVersion }> {
  const indicadorId = uuidv4();
  const now = new Date();

  const indicador = await Indicador.create({
    id: indicadorId,
    nombre: input.nombre,
    descripcion: input.descripcion,
    activo: input.activo,
    creado_en: now,
  });

  const version = await IndicadorVersion.create({
    id: uuidv4(),
    indicador_id: indicadorId,
    version: 1,
    definicion: input.definicion as unknown as Record<string, unknown>,
    creado_en: now,
  });

  return { indicador, version };
}

/**
 * Next version number for an indicador (max + 1, starting at 1).
 */
export async function nextVersion(indicadorId: string): Promise<number> {
  const maxVersion: number | null = await IndicadorVersion.max("version", {
    where: { indicador_id: indicadorId },
  });
  return (maxVersion ?? 0) + 1;
}

/**
 * Persist an additional version for an existing indicador.
 * No validation — callers validate first.
 */
export async function createIndicatorVersion(
  indicadorId: string,
  version: number,
  definicion: DefinicionIndicador,
): Promise<IndicadorVersion> {
  return IndicadorVersion.create({
    id: uuidv4(),
    indicador_id: indicadorId,
    version,
    definicion: definicion as unknown as Record<string, unknown>,
    creado_en: new Date(),
  });
}
