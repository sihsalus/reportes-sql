/**
 * Zod schemas for the indicador create/update body validation.
 *
 * `definicion` is left as `z.unknown()` because the route handlers run a
 * two-step validation after the schema parses: `rejectPeriodoInPayload`
 * then `parseDefinicionIndicador`. Keeping it `unknown` preserves that
 * ordering and those exact error responses.
 */

import { z } from "zod";

/**
 * Body schema for `POST /indicadores`. `nombre` must be a non-empty trimmed
 * string; the original handler returned a single message
 * ("nombre es obligatorio y no puede estar vacío") for every nombre
 * failure mode (missing, wrong type, empty after trim), so all of Zod's
 * failure messages are overridden to that exact string. `definicion` is
 * validated separately by the route handler.
 */
export const IndicadorCreateSchema = z.object({
  nombre: z
    .string({
      required_error: "nombre es obligatorio y no puede estar vacío",
      invalid_type_error: "nombre es obligatorio y no puede estar vacío",
    })
    .trim()
    .refine(
      (v) => v.length > 0,
      "nombre es obligatorio y no puede estar vacío",
    ),
  descripcion: z.string().nullable().optional(),
  definicion: z.unknown(),
});

/**
 * Body schema for `PUT /indicadores/:id`. `nombre` is required (the
 * original update handler returned "nombre es obligatorio" for every
 * nombre failure); `definicion` is optional (pure metadata update when
 * absent) and validated separately.
 */
export const IndicadorUpdateSchema = z.object({
  nombre: z
    .string({
      required_error: "nombre es obligatorio",
      invalid_type_error: "nombre es obligatorio",
    })
    .trim()
    .refine((v) => v.length > 0, "nombre es obligatorio"),
  descripcion: z.string().nullable().optional(),
  definicion: z.unknown().optional(),
});

export type IndicadorCreateInput = z.infer<typeof IndicadorCreateSchema>;
export type IndicadorUpdateInput = z.infer<typeof IndicadorUpdateSchema>;