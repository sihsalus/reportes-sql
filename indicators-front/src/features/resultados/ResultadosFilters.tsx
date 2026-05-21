/**
 * Filter controls for the resultados list.
 *
 * Provides an indicator `<select>` populated from `useIndicadores`
 * and two date `<input>` fields for period range. Changes are
 * debounced implicitly by the parent via React state.
 */

import type { ReactElement, ChangeEvent } from 'react';
import { useIndicadores } from '@/features/indicadores/hooks';
import ErrorState from '@/components/ErrorState';
import { parseApiError } from '@/api/client';
import type { ApiRequestError } from '@/api/client';
import type { ResultadosFilters } from '@/api/types';

export interface ResultadosFiltersProps {
  /** Current filter values. */
  filters: ResultadosFilters;
  /** Called whenever any filter value changes. */
  onChange: (filters: ResultadosFilters) => void;
}

export default function ResultadosFilters({
  filters,
  onChange,
}: ResultadosFiltersProps): ReactElement {
  const {
    data: indicadoresData,
    isLoading,
    isError,
    error,
    refetch,
  } = useIndicadores(1, 100);

  const handleIndicadorChange = (e: ChangeEvent<HTMLSelectElement>) => {
    const indicador_id = e.target.value || undefined;
    onChange({ ...filters, indicador_id });
  };

  const handlePeriodoInicioChange = (e: ChangeEvent<HTMLInputElement>) => {
    const periodo_inicio = e.target.value || undefined;
    onChange({ ...filters, periodo_inicio });
  };

  const handlePeriodoFinChange = (e: ChangeEvent<HTMLInputElement>) => {
    const periodo_fin = e.target.value || undefined;
    onChange({ ...filters, periodo_fin });
  };

  return (
    <div className="flex flex-wrap items-end gap-4 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-1">
        <label htmlFor="filter-indicador" className="text-xs font-medium text-gray-700">
          Indicador
        </label>
        {isError ? (
          <ErrorState
            message={parseApiError(error as ApiRequestError)}
            onRetry={() => refetch()}
          />
        ) : (
          <select
            id="filter-indicador"
            value={filters.indicador_id ?? ''}
            onChange={handleIndicadorChange}
            disabled={isLoading}
            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100"
            aria-label="Filtrar por indicador"
          >
            <option value="">Todos</option>
            {indicadoresData?.items.map((ind) => (
              <option key={ind.id} value={ind.id}>
                {ind.nombre}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="filter-periodo-inicio" className="text-xs font-medium text-gray-700">
          Desde
        </label>
        <input
          id="filter-periodo-inicio"
          type="date"
          value={filters.periodo_inicio ?? ''}
          onChange={handlePeriodoInicioChange}
          className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          aria-label="Filtrar desde fecha"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="filter-periodo-fin" className="text-xs font-medium text-gray-700">
          Hasta
        </label>
        <input
          id="filter-periodo-fin"
          type="date"
          value={filters.periodo_fin ?? ''}
          onChange={handlePeriodoFinChange}
          className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          aria-label="Filtrar hasta fecha"
        />
      </div>
    </div>
  );
}
