import { z } from 'zod';

/**
 * Zod schema for the indicador form — mirrors backend DefinicionIndicador.
 *
 * Used with react-hook-form's zodResolver for client-side validation.
 * diagnosticos and ordenes are nested inside the singular evento,
 * mutually exclusive via .refine().
 */

export const filtroDiagnosticoSchema = z.object({
  concepto_uuids: z.array(z.string()),
  tipo_diagnostico: z.enum(['definitivo', 'presuntivo']).optional(),
});

export const filtroOrdenSchema = z.object({
  concepto_uuids: z.array(z.string()),
});

export const eventoSchema = z
  .object({
    location_uuids: z.array(z.string()).optional(),
    minimo_ocurrencias: z.number().int().min(1).optional(),
    diagnosticos: z.array(filtroDiagnosticoSchema).optional(),
    ordenes: z.array(filtroOrdenSchema).optional(),
  })
  .refine(
    (data) => !(data.diagnosticos?.length && data.ordenes?.length),
    {
      message: 'Solo puede seleccionar diagnosticos u ordenes, no ambos',
      path: ['evento'],
    },
  );

function preprocessOptionalNumber() {
  return z.preprocess(
    (val) => (val === '' || val === undefined || Number.isNaN(val) ? undefined : Number(val)),
    z.number().int().min(0).optional(),
  );
}

export const poblacionSchema = z.object({
    min_anios: preprocessOptionalNumber(),
    max_anios_excl: preprocessOptionalNumber(),
    min_meses: preprocessOptionalNumber(),
    max_meses_excl: preprocessOptionalNumber(),
    min_dias: preprocessOptionalNumber(),
    max_dias: preprocessOptionalNumber(),
    sexo: z.preprocess(
      (val) => (val === '' ? undefined : val),
      z.enum(['M', 'F']).optional(),
    ),
  });

export const indicadorFormSchema = z.object({
    nombre: z.string().min(1, { message: 'El nombre es obligatorio' }).max(255),
    descripcion: z.string().nullable().optional(),
    tipo: z.enum(['conteo_atenciones', 'conteo_pacientes']),
    periodo: z.enum(['mes_actual', 'trimestre_actual', 'semestre_actual', 'anual_actual']),
    evento: eventoSchema.optional().nullable(),
    poblacion: poblacionSchema.optional(),
  });

export type IndicadorFormValues = z.infer<typeof indicadorFormSchema>;
