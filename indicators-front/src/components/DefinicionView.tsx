/**
 * Readable display of a DefinicionIndicadorForm.
 *
 * Replaces raw JSON rendering with human-friendly labels
 * for all definicion fields: tipo, periodo, evento
 * (with nested diagnosticos/ordenes), poblacion filters.
 *
 * Resolves location and diagnosis concept UUIDs to display
 * names via batch API endpoints.
 */

import { useMemo, type ReactElement } from 'react';
import type { DefinicionIndicadorForm } from '@/api/types';
import {
  useResolvedLocations,
  useResolvedDiagnosticos,
} from '@/features/indicadores/hooks';

// ── Label Maps ──────────────────────────────────────────────────────────

const TIPO_LABELS: Record<string, string> = {
  conteo_atenciones: 'Conteo de atenciones',
  conteo_pacientes: 'Conteo de pacientes',
  proporcion: 'Proporción',
};

const PERIODO_LABELS: Record<string, string> = {
  mes_actual: 'Mes actual',
  trimestre_actual: 'Trimestre actual',
  semestre_actual: 'Semestre actual',
  anual_actual: 'Año actual',
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

function formatAgeDimension(
  min: number | undefined,
  max: number | undefined,
  unit: string,
  maxExclusive: boolean = false,
): string | null {
  const maxUnit = maxExclusive ? `${unit} (excl.)` : unit;
  if (min === undefined && max === undefined) return null;
  if (min !== undefined && max !== undefined) {
    return `entre ${min} ${unit} y ${max} ${maxUnit}`;
  }
  if (min !== undefined) return `desde ${min} ${unit}`;
  return `hasta ${max} ${maxUnit}`;
}

// ── Helpers: UUID → Display ────────────────────────────────────────────

function formatDiagnosticoDisplay(
  uuid: string,
  resolveMap: Map<string, { codigo?: string; nombre: string }>,
): string {
  const resolved = resolveMap.get(uuid);
  if (resolved) {
    return resolved.codigo
      ? `${resolved.codigo} → ${resolved.nombre}`
      : resolved.nombre;
  }
  // Fallback: truncated UUID
  return uuid.length > 8 ? `${uuid.slice(0, 8)}…` : uuid;
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
    const anios = formatAgeDimension(pop.min_anios, pop.max_anios_excl, 'años', true);
    const meses = formatAgeDimension(pop.min_meses, pop.max_meses_excl, 'meses', true);
    const dias = formatAgeDimension(pop.min_dias, pop.max_dias, 'días', false);

    if (anios) ageLines.push(anios);
    if (meses) ageLines.push(meses);
    if (dias) ageLines.push(dias);
  }

  const sexoLabel = pop?.sexo ? (SEXO_LABELS[pop.sexo] ?? pop.sexo) : undefined;
  const hasPopFilters = ageLines.length > 0 || sexoLabel !== undefined;

  // Evento (singular)
  const ev = definicion.evento;

  // Collect all UUIDs that need resolution
  const locationUuids = useMemo(
    () => (ev?.location_uuids?.length ? ev.location_uuids : []),
    [ev?.location_uuids],
  );

  const diagUuids = useMemo(() => {
    if (!ev?.diagnosticos?.length) return [];
    const uuids: string[] = [];
    for (const diag of ev.diagnosticos) {
      if (diag.concepto_uuids?.length) {
        uuids.push(...diag.concepto_uuids);
      }
    }
    return uuids;
  }, [ev?.diagnosticos]);

  // Batch-resolve UUIDs to display names
  const { displayMap: locationDisplayMap } = useResolvedLocations(locationUuids);
  const { resolveMap: diagResolveMap } = useResolvedDiagnosticos(diagUuids);

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
        <p className="font-medium text-gray-900">🏥 Servicio:</p>
        {ev && ev.location_uuids && ev.location_uuids.length > 0 ? (
          <ul className="ml-4 list-disc pl-4 text-gray-600">
            {ev.location_uuids.map((uuid) => {
              const displayText = locationDisplayMap.get(uuid);
              return (
                <li key={uuid}>
                  {displayText ?? (
                    <span className="font-mono text-xs">
                      {uuid.length > 8 ? `${uuid.slice(0, 8)}…` : uuid}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="ml-4 text-gray-600">Todos los servicios</p>
        )}
        {ev && ev.minimo_ocurrencias && ev.minimo_ocurrencias > 1 && (
          <p className="ml-4 text-gray-600">
            Mínimo de atenciones: {ev.minimo_ocurrencias}
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
                  <span>
                    {diag.concepto_uuids
                      .map((u) => formatDiagnosticoDisplay(u, diagResolveMap))
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
              <li key={idx}>
                {ord.concepto_uuids && ord.concepto_uuids.length > 0 ? (
                  <span className="font-mono text-xs">
                    {ord.concepto_uuids
                      .map((u) => (u.length > 8 ? `${u.slice(0, 8)}…` : u))
                      .join(', ')}
                  </span>
                ) : (
                  <span className="text-gray-400">Sin concepto</span>
                )}
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
