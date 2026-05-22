/**
 * Parse a raw definicion object (from the API) into the typed form shape.
 *
 * Used by both IndicadorFormPage (edit mode) and IndicadorDetailPage
 * (new version form) to pre-populate the IndicadorForm component.
 *
 * Normalizes old flat JSONB (top-level diagnostico/observaciones) into
 * the new nested evento shape (evento.diagnosticos/evento.ordenes).
 * Already-nested data passes through unchanged (idempotent).
 */

import type { DefinicionIndicadorForm, FiltroDiagnosticoForm, FiltroOrdenForm } from '@/api/types';

/**
 * Convert a raw definicion object (Record<string, unknown>) from the API
 * into the typed DefinicionIndicadorForm shape expected by IndicadorForm.
 *
 * Returns sensible defaults for any missing fields.
 * Handles both old-format JSONB (eventos array, flat diagnostico/observaciones)
 * and new-format (evento singular with nested diagnosticos/ordenes).
 */
export function parseDefinicion(def: unknown): DefinicionIndicadorForm {
  const d = def as Record<string, unknown> | undefined;
  if (!d) {
    return {
      tipo: 'conteo_atenciones',
      periodo: 'mes_actual',
      evento: { encounter_type_uuids: [], minimo_ocurrencias: 1 },
    };
  }

  // ── Evento: singular (new format) or first element of eventos (old format) ──
  let eventoRaw: Record<string, unknown> | undefined;
  if (d.evento) {
    eventoRaw = d.evento as Record<string, unknown>;
  } else if (Array.isArray(d.eventos) && d.eventos.length > 0) {
    // Backward compat: old JSONB with eventos array — pick first element
    eventoRaw = (d.eventos as unknown[])[0] as Record<string, unknown>;
  }

  if (!eventoRaw) {
    eventoRaw = {};
  }

  // ── Diagnosticos: read from nested shape or normalize from old flat ──
  let diagnosticos: FiltroDiagnosticoForm[] | undefined;
  if (Array.isArray(eventoRaw.diagnosticos)) {
    diagnosticos = (eventoRaw.diagnosticos as unknown[]).map(
      (item) => {
        const i = item as Record<string, unknown>;
        return {
          concepto_uuids: Array.isArray(i.concepto_uuids) ? i.concepto_uuids as string[] : [],
          tipo_diagnostico:
            (i.tipo_diagnostico as 'definitivo' | 'presuntivo' | undefined) ?? undefined,
        };
      },
    );
  } else if (d.diagnostico) {
    // Backward compat: hoist old flat diagnostico into evento.diagnosticos
    const oldDiag = d.diagnostico as Record<string, unknown>;
    const tipo = oldDiag.tipo_diagnostico as 'definitivo' | 'presuntivo' | undefined;
    if (tipo) {
      diagnosticos = [{ concepto_uuids: [], tipo_diagnostico: tipo }];
    }
  }

  // ── Ordenes: read from nested shape or normalize from old flat ──
  let ordenes: FiltroOrdenForm[] | undefined;
  if (Array.isArray(eventoRaw.ordenes)) {
    ordenes = (eventoRaw.ordenes as unknown[])
      .filter((o): o is Record<string, unknown> => o !== null && typeof o === 'object')
      .map((o) => ({
        concepto_uuid: typeof o.concepto_uuid === 'string' ? o.concepto_uuid : '',
      }))
      .filter((o) => o.concepto_uuid.length > 0);
  } else if (Array.isArray(d.observaciones)) {
    // Backward compat: hoist old flat observaciones into evento.ordenes
    ordenes = (d.observaciones as unknown[])
      .filter((o): o is Record<string, unknown> => o !== null && typeof o === 'object')
      .map((o) => ({
        concepto_uuid: typeof o.concepto_uuid === 'string' ? o.concepto_uuid : '',
      }))
      .filter((o) => o.concepto_uuid.length > 0);
  }

  if (ordenes && ordenes.length === 0) {
    ordenes = undefined;
  }
  if (diagnosticos && diagnosticos.length === 0) {
    diagnosticos = undefined;
  }

  // ── Build evento ──
  const evento = {
    encounter_type_uuids: Array.isArray(eventoRaw.encounter_type_uuids)
      ? (eventoRaw.encounter_type_uuids as string[])
      : [],
    minimo_ocurrencias:
      typeof eventoRaw.minimo_ocurrencias === 'number'
        ? eventoRaw.minimo_ocurrencias
        : undefined,
    diagnosticos,
    ordenes,
  };

  // ── Poblacion ──
  const poblacionRaw = d.poblacion as Record<string, unknown> | undefined;
  const poblacion = poblacionRaw
    ? {
        edad_min_anios:
          typeof poblacionRaw.edad_min_anios === 'number'
            ? poblacionRaw.edad_min_anios
            : undefined,
        edad_max_anios:
          typeof poblacionRaw.edad_max_anios === 'number'
            ? poblacionRaw.edad_max_anios
            : undefined,
        edad_min_meses:
          typeof poblacionRaw.edad_min_meses === 'number'
            ? poblacionRaw.edad_min_meses
            : undefined,
        edad_max_meses:
          typeof poblacionRaw.edad_max_meses === 'number'
            ? poblacionRaw.edad_max_meses
            : undefined,
        edad_min_dias:
          typeof poblacionRaw.edad_min_dias === 'number'
            ? poblacionRaw.edad_min_dias
            : undefined,
        edad_max_dias:
          typeof poblacionRaw.edad_max_dias === 'number'
            ? poblacionRaw.edad_max_dias
            : undefined,
        sexo:
          (poblacionRaw.sexo as 'M' | 'F' | undefined) ?? undefined,
      }
    : undefined;

  return {
    tipo: (d.tipo as 'conteo_atenciones' | 'conteo_pacientes') ?? 'conteo_atenciones',
    periodo:
      (d.periodo as 'mes_actual' | 'mes_anterior' | 'semana_actual' | 'semana_anterior') ??
      'mes_actual',
    evento,
    poblacion,
  };
}
