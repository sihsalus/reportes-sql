/**
 * Zod schemas for meta (annual target) management endpoints.
 *
 * - MetaUpsertSchema  — PUT /metas body validation
 * - MetaQuerySchema   — GET  /metas query validation (version or indicator lookup)
 * - MetaDeleteSchema  — DELETE /metas query validation
 */

import { z } from "zod";

// ── PUT /metas ──────────────────────────────────────────────────────────

export const MetaUpsertSchema = z.object({
  indicador_version_id: z.string().uuid("indicador_version_id debe ser un UUID válido"),
  anio: z.coerce.number().int("anio debe ser un entero").min(2000, "anio debe estar en el rango 2000-2100").max(2100, "anio debe estar en el rango 2000-2100"),
  valor_meta: z.number().min(0, "valor_meta no puede ser negativo"),
});

export type MetaUpsertInput = z.infer<typeof MetaUpsertSchema>;

// ── GET /metas ──────────────────────────────────────────────────────────

export const MetaQuerySchema = z
  .object({
    indicador_version_id: z.string().uuid().optional(),
    indicador_id: z.string().uuid().optional(),
    anio: z.coerce.number().int().min(2000).max(2100),
  })
  .superRefine((val, ctx) => {
    const hasVersion = val.indicador_version_id !== undefined;
    const hasIndicador = val.indicador_id !== undefined;

    if (hasVersion && hasIndicador) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Solo uno de indicador_version_id o indicador_id es permitido",
        path: ["indicador_id"],
      });
    }

    if (!hasVersion && !hasIndicador) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Se requiere indicador_version_id o indicador_id",
        path: ["indicador_version_id"],
      });
    }
  });

export type MetaQueryInput = z.infer<typeof MetaQuerySchema>;

// ── DELETE /metas ────────────────────────────────────────────────────────

export const MetaDeleteSchema = z.object({
  indicador_version_id: z.string().uuid("indicador_version_id debe ser un UUID válido"),
  anio: z.coerce.number().int("anio debe ser un entero").min(2000, "anio debe estar en el rango 2000-2100").max(2100, "anio debe estar en el rango 2000-2100"),
});

export type MetaDeleteInput = z.infer<typeof MetaDeleteSchema>;
