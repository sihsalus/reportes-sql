/**
 * Resultados listing table with loading, error, and empty states.
 *
 * Renders a semantic `<table>` with 6 columns: Indicador, Versión,
 * Periodo Inicio, Periodo Fin, Valor, and Calculado en.
 * Delegates loading and error rendering to shared components.
 */

import type { ReactElement } from 'react';
import LoadingState from '@/components/LoadingState';
import ErrorState from '@/components/ErrorState';
import type { IndicadorResultado } from '@/api/types';

export interface ResultadosTableProps {
  /** The list of indicator results to display. */
  items: IndicadorResultado[];
  /** Whether a fetch is in progress. When `true`, shows LoadingState. */
  isLoading: boolean;
  /** Whether the last fetch failed. When `true`, shows ErrorState. */
  isError: boolean;
  /** The fetch error object, if any. */
  error: Error | null;
  /** Called when the user clicks "Reintentar" on the error state. */
  onRetry?: () => void;
}

export default function ResultadosTable({
  items,
  isLoading,
  isError,
  error,
  onRetry,
}: ResultadosTableProps): ReactElement {
  if (isLoading) {
    return <LoadingState />;
  }

  if (isError) {
    const message =
      error?.message ?? 'Error desconocido al cargar los resultados.';
    return <ErrorState message={message} onRetry={onRetry} />;
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
      <table className="min-w-full divide-y divide-gray-200" aria-label="Listado de resultados">
        <caption className="sr-only">
          Tabla de resultados con columnas: Indicador, Versión, Periodo Inicio, Periodo Fin, Valor y Calculado en.
        </caption>
        <thead className="bg-gray-50">
          <tr>
            <th
              scope="col"
              className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500"
            >
              Indicador
            </th>
            <th
              scope="col"
              className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500"
            >
              Versión
            </th>
            <th
              scope="col"
              className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500"
            >
              Periodo Inicio
            </th>
            <th
              scope="col"
              className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500"
            >
              Periodo Fin
            </th>
            <th
              scope="col"
              className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-gray-500"
            >
              Valor
            </th>
            <th
              scope="col"
              className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500"
            >
              Calculado en
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200">
          {items.length === 0 ? (
            <tr>
              <td
                colSpan={6}
                className="px-4 py-16 text-center text-sm text-gray-500"
              >
                No hay resultados
              </td>
            </tr>
          ) : (
            items.map((resultado) => (
              <tr key={resultado.id}>
                <td className="px-4 py-3 text-sm text-gray-900">
                  {resultado.indicador_nombre ?? '—'}
                </td>
                <td className="px-4 py-3 text-sm text-gray-900">
                  {resultado.indicador_version_num ?? '—'}
                </td>
                <td className="px-4 py-3 text-sm text-gray-900">
                  {resultado.periodo_inicio}
                </td>
                <td className="px-4 py-3 text-sm text-gray-900">
                  {resultado.periodo_fin}
                </td>
                <td className="px-4 py-3 text-right text-sm font-medium text-gray-900">
                  {resultado.valor.toLocaleString('es-ES')}
                </td>
                <td className="px-4 py-3 text-sm text-gray-500">
                  {new Date(resultado.calculado_en).toLocaleString('es-ES')}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
