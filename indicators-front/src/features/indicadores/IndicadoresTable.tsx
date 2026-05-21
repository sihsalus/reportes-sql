/**
 * Indicator listing table with loading, error, and empty states.
 *
 * Renders a semantic `<table>` with column headers and one
 * `<IndicadorRow>` per item. Delegates loading and error rendering
 * to shared `<LoadingState>` / `<ErrorState>` components.
 */

import type { ReactElement } from 'react';
import IndicadorRow from '@/features/indicadores/IndicadorRow';
import LoadingState from '@/components/LoadingState';
import ErrorState from '@/components/ErrorState';
import type { Indicador } from '@/api/types';

export interface IndicadoresTableProps {
  /** The list of indicators to display. */
  items: Indicador[];
  /** Whether a fetch is in progress. When `true`, shows LoadingState. */
  isLoading: boolean;
  /** Whether the last fetch failed. When `true`, shows ErrorState. */
  isError: boolean;
  /** The fetch error object, if any. */
  error: Error | null;
  /** Called when the user clicks "Reintentar" on the error state. */
  onRetry?: () => void;
  /** Placeholder action: called when "Ver" is clicked on a row. */
  onView?: (id: string) => void;
  /** Placeholder action: called when "Editar" is clicked on a row. */
  onEdit?: (id: string) => void;
}

export default function IndicadoresTable({
  items,
  isLoading,
  isError,
  error,
  onRetry,
  onView,
  onEdit,
}: IndicadoresTableProps): ReactElement {
  if (isLoading) {
    return <LoadingState />;
  }

  if (isError) {
    const message =
      error?.message ?? 'Error desconocido al cargar los indicadores.';
    return <ErrorState message={message} onRetry={onRetry} />;
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
      <table className="min-w-full divide-y divide-gray-200" aria-label="Listado de indicadores">
        <caption className="sr-only">
          Tabla de indicadores con columnas: Nombre, Descripción, Estado, Creado
          y Acciones.
        </caption>
        <thead className="bg-gray-50">
          <tr>
            <th
              scope="col"
              className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500"
            >
              Nombre
            </th>
            <th
              scope="col"
              className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500"
            >
              Descripción
            </th>
            <th
              scope="col"
              className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500"
            >
              Estado
            </th>
            <th
              scope="col"
              className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500"
            >
              Creado
            </th>
            <th
              scope="col"
              className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-gray-500"
            >
              Acciones
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200">
          {items.length === 0 ? (
            <tr>
              <td
                colSpan={5}
                className="px-4 py-16 text-center text-sm text-gray-500"
              >
                No hay indicadores
              </td>
            </tr>
          ) : (
            items.map((indicador) => (
              <IndicadorRow
                key={indicador.id}
                indicador={indicador}
                onView={onView}
                onEdit={onEdit}
              />
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
