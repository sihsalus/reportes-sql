/**
 * Zod metamodel for indicator definitions.
 *
 * Pure Zod types with zero ORM coupling. These schemas are the canonical
 * representation of an indicator definition, used both for API validation
 * and SQL generation in the engine layer.
 *
 * Format validation lives here — existence checks (OpenMRS UUID resolution)
 * are deferred to the router/validator layer (I/O), keeping schemas
 * side-effect-free and testable in isolation.
 */

import { z } from "zod";

// ── Type aliases ───────────────────────────────────────────────────────

export const TipoIndicador = z.enum(["conteo_atenciones", "conteo_pacientes"]);
export type TipoIndicador = z.infer<typeof TipoIndicador>;

export const PeriodoIndicador = z.enum([
  "mes_actual",
  "trimestre_actual",
  "semestre_actual",
  "anual_actual",
]);
export type PeriodoIndicador = z.infer<typeof PeriodoIndicador>;

// ── Filter schemas ─────────────────────────────────────────────────────

export const FiltrosPoblacionSchema = z
  .object({
    min_dias: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe(
        "Edad mínima en días (inclusivo). Evaluada contra la fecha del encuentro, no el inicio del período.",
      ),
    min_meses: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe(
        "Edad mínima en meses (inclusivo). Evaluada contra la fecha del encuentro.",
      ),
    min_anios: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe(
        "Edad mínima en años (inclusivo). Evaluada contra la fecha del encuentro.",
      ),
    max_dias: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe(
        "Edad máxima en días (inclusivo). Evaluada contra la fecha del encuentro, no el inicio del período.",
      ),
    max_meses_excl: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe(
        "Edad máxima en meses (exclusivo). El encuentro debe ser anterior al cumpleaños exacto. Evaluada contra la fecha del encuentro.",
      ),
    max_anios_excl: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe(
        "Edad máxima en años (exclusivo). El encuentro debe ser anterior al cumpleaños exacto. Evaluada contra la fecha del encuentro.",
      ),
    sexo: z.enum(["M", "F"]).optional(),
  })
  .superRefine((data, ctx) => {
    // ── Mutual exclusivity per bound group ──
    const minCount = [data.min_dias, data.min_meses, data.min_anios].filter(
      (v): v is number => v !== undefined,
    ).length;
    const maxCount = [
      data.max_dias,
      data.max_meses_excl,
      data.max_anios_excl,
    ].filter((v): v is number => v !== undefined).length;

    if (minCount > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "min_dias, min_meses, and min_anios are mutually exclusive — at most one may be set",
        path: ["min_dias"],
      });
    }
    if (maxCount > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "max_dias, max_meses_excl, and max_anios_excl are mutually exclusive — at most one may be set",
        path: ["max_dias"],
      });
    }
  });
export type FiltrosPoblacion = z.infer<typeof FiltrosPoblacionSchema>;

export const FiltroDiagnosticoSchema = z.object({
  concepto_uuids: z.array(z.string()).default([]),
  tipo_diagnostico: z
    .enum(["definitivo", "presuntivo"])
    .optional(),
});
export type FiltroDiagnostico = z.infer<typeof FiltroDiagnosticoSchema>;

export const FiltroOrdenSchema = z.object({
  concepto_uuid: z.string().min(1),
});
export type FiltroOrden = z.infer<typeof FiltroOrdenSchema>;

export const FiltrosEventoSchema = z
  .object({
    location_uuids: z.array(z.string()).optional(),
    minimo_ocurrencias: z.number().int().min(1).optional(),
    diagnosticos: z.array(FiltroDiagnosticoSchema).optional(),
    ordenes: z.array(FiltroOrdenSchema).optional(),
  })
  .superRefine((data, ctx) => {
    const hasDiag =
      data.diagnosticos !== undefined && data.diagnosticos.length > 0;
    const hasOrd =
      data.ordenes !== undefined && data.ordenes.length > 0;
    if (hasDiag && hasOrd) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "diagnosticos and ordenes are mutually exclusive",
        path: ["diagnosticos"],
      });
    }
  });
export type FiltrosEvento = z.infer<typeof FiltrosEventoSchema>;

// ── Top-level definition ───────────────────────────────────────────────

export const DefinicionIndicadorSchema = z
  .object({
    tipo: TipoIndicador,
    periodo: PeriodoIndicador.optional(),
    poblacion: FiltrosPoblacionSchema.optional(),
    evento: FiltrosEventoSchema.optional(),
  });
export type DefinicionIndicador = z.infer<typeof DefinicionIndicadorSchema>;

// ── Legacy normalization ────────────────────────────────────────────────

/**
 * Preprocess hook for FiltrosPoblacion: normalize legacy edad_* keys
 * to canonical min_* / max_* keys.
 */
export function normalizePoblacionLegacy(
  data: unknown,
): unknown {
  if (typeof data !== "object" || data === null) return data;

  const d = data as Record<string, unknown>;

  const legacyKeys = new Set([
    "edad_min_anios",
    "edad_min_meses",
    "edad_min_dias",
    "edad_max_anios",
    "edad_max_meses",
    "edad_max_dias",
  ]);

  const canonicalKeys = new Set([
    "min_anios",
    "min_meses",
    "min_dias",
    "max_anios_excl",
    "max_meses_excl",
    "max_dias",
  ]);

  const hasLegacy = Object.keys(d).some((k) => legacyKeys.has(k));
  const hasCanonical = Object.keys(d).some((k) => canonicalKeys.has(k));

  if (hasLegacy && hasCanonical) {
    throw new Error(
      "Cannot mix legacy age fields (edad_*) with canonical age fields (min_*/max_*). Use one naming convention only.",
    );
  }

  if (!hasLegacy) return data;

  const mapping: Record<string, string> = {
    edad_min_anios: "min_anios",
    edad_min_meses: "min_meses",
    edad_min_dias: "min_dias",
    edad_max_anios: "max_anios_excl",
    edad_max_meses: "max_meses_excl",
    edad_max_dias: "max_dias",
  };

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(d)) {
    if (key in mapping) {
      result[mapping[key]] = value;
    } else if (!legacyKeys.has(key)) {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Preprocess hook for FiltrosEvento: normalize legacy encounter_type_uuids
 * to location_uuids.
 */
export function normalizeEventoLegacy(data: unknown): unknown {
  if (typeof data !== "object" || data === null) return data;

  const d = data as Record<string, unknown>;

  if ("location_uuids" in d) {
    // Already has new field — strip legacy if present
    const { encounter_type_uuids: _, ...rest } = d;
    return rest;
  }

  if ("encounter_type_uuids" in d) {
    const { encounter_type_uuids, ...rest } = d;
    return { ...rest, location_uuids: encounter_type_uuids };
  }

  return data;
}

/**
 * Remove `periodo` from a stored definition for backward compatibility.
 * Legacy definitions may have a `periodo` field that is no longer meaningful;
 * this function strips it so downstream parsers see a clean shape.
 */
export function stripPeriodoFromDefinicion(data: unknown): unknown {
  if (typeof data !== "object" || data === null) return data;
  const d = data as Record<string, unknown>;
  if ("periodo" in d) {
    const { periodo: _, ...rest } = d;
    return rest;
  }
  return data;
}

/**
 * Preprocess hook for DefinicionIndicador: normalize flat JSONB shapes
 * (old diagnostico, observaciones, eventos[]) into nested evento structure.
 * Also strips legacy `periodo` from stored JSONB for backward compatibility.
 */
export function normalizeDefinicionFlat(data: unknown): unknown {
  if (typeof data !== "object" || data === null) return data;

  let d = { ...(data as Record<string, unknown>) };

  // ── Strip legacy periodo (stored JSONB backward compat) ──
  d = stripPeriodoFromDefinicion(d) as Record<string, unknown>;

  // ── Normalize nested poblacion first (legacy edad_* keys) ──
  if ("poblacion" in d && typeof d["poblacion"] === "object" && d["poblacion"] !== null) {
    d["poblacion"] = normalizePoblacionLegacy(d["poblacion"]);
  }

  // ── Normalize old eventos array → singular evento ──
  if (!("evento" in d) && "eventos" in d) {
    const eventos = d["eventos"] as unknown;
    delete d["eventos"];
    if (Array.isArray(eventos) && eventos.length > 0) {
      d["evento"] = { ...(eventos[0] as Record<string, unknown>) };
    }
  }

  const evento = d["evento"];
  if (typeof evento !== "object" || evento === null || Array.isArray(evento)) {
    // No evento or non-object — strip flat keys
    delete d["diagnostico"];
    delete d["observaciones"];
    return d;
  }

  const ev = evento as Record<string, unknown>;

  if ("diagnosticos" in ev || "ordenes" in ev) {
    // Already nested — pass through
    delete d["diagnostico"];
    delete d["observaciones"];
    return d;
  }

  const oldDiag = d["diagnostico"];
  const oldObs = d["observaciones"];
  delete d["diagnostico"];
  delete d["observaciones"];

  // ── Old diagnostico → evento.diagnosticos ──
  if (typeof oldDiag === "object" && oldDiag !== null) {
    const diag = oldDiag as Record<string, unknown>;
    const tipo = diag["tipo_diagnostico"];
    if (tipo !== undefined && tipo !== null) {
      ev["diagnosticos"] = [
        {
          concepto_uuids: [],
          tipo_diagnostico: tipo,
        },
      ];
    }
  }

  // ── Old observaciones → evento.ordenes ──
  if (Array.isArray(oldObs)) {
    const ordenes: unknown[] = [];
    for (const obs of oldObs) {
      if (
        typeof obs === "object" &&
        obs !== null &&
        (obs as Record<string, unknown>)["concepto_uuid"]
      ) {
        ordenes.push({
          concepto_uuid: (obs as Record<string, unknown>)["concepto_uuid"],
        });
      }
    }
    if (ordenes.length > 0) {
      ev["ordenes"] = ordenes;
    }
  }

  d["evento"] = ev;

  // ── Normalize evento legacy encounter_type_uuids ──
  if (typeof d["evento"] === "object" && d["evento"] !== null) {
    d["evento"] = normalizeEventoLegacy(d["evento"]);
  }

  return d;
}

// ── Parsing helpers ─────────────────────────────────────────────────────

/**
 * Parse and validate a DefinicionIndicador with full legacy normalization.
 *
 * Use this for stored JSONB reads (which may contain legacy `periodo`).
 * For API request bodies, call `rejectPeriodoInPayload` first to reject
 * inbound payloads that still include `periodo`.
 */
export function parseDefinicionIndicador(
  data: unknown,
): DefinicionIndicador {
  const step1 = normalizeDefinicionFlat(data);
  return DefinicionIndicadorSchema.parse(step1);
}

/**
 * Check whether a raw definition payload contains a `periodo` field and
 * throw a validation error if it does. Call this BEFORE parseDefinicionIndicador
 * on inbound API payloads to reject the old contract.
 */
export function rejectPeriodoInPayload(data: unknown): void {
  if (typeof data === "object" && data !== null && "periodo" in (data as Record<string, unknown>)) {
    throw new Error(
      "El campo 'periodo' ya no se acepta. Las mediciones son siempre mensuales.",
    );
  }
}

/**
 * Parse FiltrosPoblacion with legacy age-field normalization.
 */
export function parseFiltrosPoblacion(
  data: unknown,
): FiltrosPoblacion {
  const normalized = normalizePoblacionLegacy(data);
  return FiltrosPoblacionSchema.parse(normalized);
}

/**
 * Parse FiltrosEvento with legacy encounter_type_uuids normalization.
 */
export function parseFiltrosEvento(data: unknown): FiltrosEvento {
  const normalized = normalizeEventoLegacy(data);
  return FiltrosEventoSchema.parse(normalized);
}

// ── Helper: has_age_filter ──────────────────────────────────────────────

export function hasAgeFilter(poblacion: FiltrosPoblacion): boolean {
  return (
    poblacion.min_dias !== undefined ||
    poblacion.min_meses !== undefined ||
    poblacion.min_anios !== undefined ||
    poblacion.max_dias !== undefined ||
    poblacion.max_meses_excl !== undefined ||
    poblacion.max_anios_excl !== undefined
  );
}
