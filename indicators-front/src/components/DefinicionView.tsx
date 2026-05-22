/**
 * Readable display of a DefinicionIndicadorForm.
 *
 * Replaces raw JSON rendering with human-friendly labels
 * for all definicion fields: tipo, periodo, evento
 * (with nested diagnosticos/ordenes), poblacion filters.
 */

import type { ReactElement } from 'react';
import type { DefinicionIndicadorForm } from '@/api/types';

// ── Label Maps ──────────────────────────────────────────────────────────

const TIPO_LABELS: Record<string, string> = {
  conteo_atenciones: 'Conteo de atenciones',
  conteo_pacientes: 'Conteo de pacientes',
  proporcion: 'Proporción',
};

const PERIODO_LABELS: Record<string, string> = {
  mes_actual: 'Mes actual',
  mes_anterior: 'Mes anterior',
  semana_actual: 'Semana actual',
  semana_anterior: 'Semana anterior',
};

const SEXO_LABELS: Record<string, string> = {
  M: 'Masculino',
  F: 'Femenino',
};

const TIPO_DIAG_LABELS: Record<string, string> = {
  definitivo: 'Definitivo',
  presuntivo: 'Presuntivo',
};

// ── Helper: Age Range ───────────────────────────────────────────────────

interface AgeRangeParts {
  min?: number;
  max?: number;
  label: string; // e.g. "años", "meses", "días"
}

function formatAgeDimension(parts: AgeRangeParts): string | null {
  const { min, max, label } = parts;
  if (min === undefined && max === undefined) return null;
  if (min !== undefined && max !== undefined) return `entre ${min} ${label} y ${max} ${label}`;
  if (min !== undefined) return `desde ${min} ${label}`;
  return `hasta ${max} ${label}`;
}

// ── Main Component ──────────────────────────────────────────────────────

interface DefinicionViewProps {
  definicion: DefinicionIndicadorForm;
}

export default function DefinicionView({ definicion }: DefinicionViewProps): ReactElement {
  const tipoLabel = TIPO_LABELS[definicion.tipo] ?? definicion.tipo;
  const periodoLabel = PERIODO_LABELS[definicion.periodo] ?? definicion.periodo;

  // Poblacion
  const pop = definicion.poblacion;
  const ageLines: string[] = [];

  if (pop) {
    const anios = formatAgeDimension({ min: pop.edad_min_anios, max: pop.edad_max_anios, label: 'años' });
    const meses = formatAgeDimension({ min: pop.edad_min_meses, max: pop.edad_max_meses, label: 'meses' });
    const dias = formatAgeDimension({ min: pop.edad_min_dias, max: pop.edad_max_dias, label: 'días' });

    if (anios) ageLines.push(anios);
    if (meses) ageLines.push(meses);
    if (dias) ageLines.push(dias);
  }

  const sexoLabel = pop?.sexo ? (SEXO_LABELS[pop.sexo] ?? pop.sexo) : undefined;
  const hasPopFilters = ageLines.length > 0 || sexoLabel !== undefined;

  // Evento (singular) — with nested diagnosticos / ordenes
  const ev = definicion.evento;

  return (
    <div className="space-y-2 text-sm text-gray-700">
      {/* Header line */}
      <p className="font-medium text-gray-900">
        📊 {tipoLabel}
        {' · '}
        Período: {periodoLabel}
      </p>

      {/* Evento (singular) */}
      <div>
        <p className="font-medium text-gray-900">🏥 Tipo de encuentro:</p>
        {ev && ev.encounter_type_uuids && ev.encounter_type_uuids.length > 0 ? (
          <ul className="ml-4 list-disc pl-4 text-gray-600">
            {ev.encounter_type_uuids.map((uuid) => (
              <li key={uuid} className="font-mono text-xs">
                {uuid.length > 8 ? `${uuid.slice(0, 8)}…` : uuid}
              </li>
            ))}
          </ul>
        ) : (
          <p className="ml-4 text-gray-600">Todos los tipos de encuentro</p>
        )}
        {ev && ev.minimo_ocurrencias && ev.minimo_ocurrencias > 1 && (
          <p className="ml-4 text-gray-600">
            Mínimo de ocurrencias: {ev.minimo_ocurrencias}
          </p>
        )}
      </div>

      {/* Diagnosticos (nested in evento) */}
      {ev && ev.diagnosticos && ev.diagnosticos.length > 0 && (
        <div>
          <p className="font-medium text-gray-900">🩺 Diagnósticos:</p>
          <ul className="ml-4 list-disc pl-4 text-gray-600">
            {ev.diagnosticos.map((diag, idx) => (
              <li key={idx}>
                {diag.concepto_uuids && diag.concepto_uuids.length > 0 ? (
                  <span className="font-mono text-xs">
                    {diag.concepto_uuids
                      .map((u) => (u.length > 8 ? `${u.slice(0, 8)}…` : u))
                      .join(', ')}
                  </span>
                ) : (
                  <span className="text-gray-400">Sin concepto</span>
                )}
                {diag.tipo_diagnostico && (
                  <span className="ml-2">
                    ({TIPO_DIAG_LABELS[diag.tipo_diagnostico] ?? diag.tipo_diagnostico})
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Ordenes (nested in evento) */}
      {ev && ev.ordenes && ev.ordenes.length > 0 && (
        <div>
          <p className="font-medium text-gray-900">🔬 Órdenes requeridas:</p>
          <ul className="ml-4 list-disc pl-4 text-gray-600">
            {ev.ordenes.map((ord, idx) => (
              <li key={idx} className="font-mono text-xs">
                {ord.concepto_uuid.length > 8
                  ? `${ord.concepto_uuid.slice(0, 8)}…`
                  : ord.concepto_uuid}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Poblacion */}
      {hasPopFilters ? (
        <div>
          <p className="font-medium text-gray-900">👥 Población:</p>
          <ul className="ml-4 list-disc pl-4 text-gray-600">
            {ageLines.map((line) => (
              <li key={line}>{line}</li>
            ))}
            {sexoLabel && <li>Sexo: {sexoLabel}</li>}
          </ul>
        </div>
      ) : (
        <p className="font-medium text-gray-900">
          👥 Población:{' '}
          <span className="font-normal text-gray-600">Sin filtros de población</span>
        </p>
      )}
    </div>
  );
}
