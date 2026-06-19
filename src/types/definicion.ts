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
 *
 * The definition contract is canonical only: no legacy normalization is
 * performed. Pre-production, inbound payloads are expected to match the
 * shape below exactly. `rejectPeriodoInPayload` is the one exception kept
 * at the router level for explicit, clearer inbound-rejection errors.
 */

import { z } from "zod";

// ── Type aliases ───────────────────────────────────────────────────────

export const TipoIndicador = z.enum(["conteo_atenciones", "conteo_pacientes"]);
export type TipoIndicador = z.infer<typeof TipoIndicador>;

/**
 * Period literal used to derive result periods at the engine layer
 * (e.g. `calcularPeriodo`). It is NOT a field of the indicator
 * definition — measurements are always monthly. Kept exported because
 * `src/engine/periodo.ts` consumes it.
 */
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
  .strict()
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

export const FiltroDiagnosticoSchema = z
  .object({
    concepto_uuids: z.array(z.string()).default([]),
    tipo_diagnostico: z
      .enum(["definitivo", "presuntivo"])
      .optional(),
  })
  .strict();
export type FiltroDiagnostico = z.infer<typeof FiltroDiagnosticoSchema>;

export const FiltroOrdenSchema = z
  .object({
    concepto_uuid: z.string().min(1),
  })
  .strict();
export type FiltroOrden = z.infer<typeof FiltroOrdenSchema>;

export const FiltrosEventoSchema = z
  .object({
    location_uuids: z.array(z.string()).optional(),
    minimo_ocurrencias: z.number().int().min(1).optional(),
    diagnosticos: z.array(FiltroDiagnosticoSchema).optional(),
    ordenes: z.array(FiltroOrdenSchema).optional(),
  })
  .strict()
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

/**
 * Canonical indicator definition.
 *
 * The definition contract is intentionally minimal: `tipo` is required,
 * `poblacion` and `evento` are optional filter groups. Result periods
 * are derived at the engine layer, not stored on the definition.
 *
 * `.strict()` rejects any unknown key (legacy or otherwise) so the
 * canonical shape is enforced at the boundary.
 */
export const DefinicionIndicadorSchema = z
  .object({
    tipo: TipoIndicador,
    poblacion: FiltrosPoblacionSchema.optional(),
    evento: FiltrosEventoSchema.optional(),
  })
  .strict();
export type DefinicionIndicador = z.infer<typeof DefinicionIndicadorSchema>;

// ── Parsing helpers ─────────────────────────────────────────────────────

/**
 * Parse and validate a DefinicionIndicador against the canonical schema.
 *
 * Performs strict shape validation only — no legacy normalization, no
 * field rewrites. For inbound API payloads, call `rejectPeriodoInPayload`
 * first to reject old contracts with a clear error.
 */
export function parseDefinicionIndicador(
  data: unknown,
): DefinicionIndicador {
  return DefinicionIndicadorSchema.parse(data);
}

/**
 * Reject a raw inbound payload that still carries the legacy top-level
 * `periodo` field. Kept as a separate helper so routers can return a
 * precise 422 error before the main schema runs.
 */
export function rejectPeriodoInPayload(data: unknown): void {
  if (typeof data === "object" && data !== null && "periodo" in (data as Record<string, unknown>)) {
    throw new Error(
      "El campo 'periodo' ya no se acepta. Las mediciones son siempre mensuales.",
    );
  }
}

/**
 * Parse FiltrosPoblacion against the canonical schema.
 */
export function parseFiltrosPoblacion(
  data: unknown,
): FiltrosPoblacion {
  return FiltrosPoblacionSchema.parse(data);
}

/**
 * Parse FiltrosEvento against the canonical schema.
 */
export function parseFiltrosEvento(data: unknown): FiltrosEvento {
  return FiltrosEventoSchema.parse(data);
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
