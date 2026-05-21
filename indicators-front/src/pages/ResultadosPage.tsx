/**
 * Resultados page — wires filters, table, pagination, calcular-ahora
 * button, and inline banner.
 */

import { useState, type ReactElement } from 'react';
import { useResultados, useCalcularAhora } from '@/features/resultados/hooks';
import ResultadosTable from '@/features/resultados/ResultadosTable';
import ResultadosFilters from '@/features/resultados/ResultadosFilters';
import Pagination from '@/components/Pagination';
import type { ResultadosFilters as FiltersType } from '@/api/types';

export default function ResultadosPage(): ReactElement {
  const [filters, setFilters] = useState<FiltersType>({});
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const { data, isLoading, isError, error, refetch } = useResultados({
    ...filters,
    page,
    size: pageSize,
  });

  const {
    calcularAhora,
    isPending,
    data: calcularAhoraData,
    isError: isCalcularError,
    error: calcularError,
  } = useCalcularAhora();

  const handleFilterChange = (newFilters: FiltersType) => {
    setFilters(newFilters);
    setPage(1);
  };

  const handlePageChange = (newPage: number) => {
    setPage(newPage);
  };

  const handleSizeChange = (newSize: number) => {
    setPageSize(newSize);
    setPage(1);
  };

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Resultados</h1>
        <button
          type="button"
          onClick={calcularAhora}
          disabled={isPending}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isPending ? 'Calculando…' : 'Calcular Ahora'}
        </button>
      </div>

      {calcularAhoraData && (
        <div
          className={`mb-4 rounded-md border p-4 ${
            calcularAhoraData.errores.length > 0
              ? 'border-yellow-300 bg-yellow-50'
              : 'border-green-300 bg-green-50'
          }`}
        >
          <p className="text-sm font-medium">
            {calcularAhoraData.calculados} indicadores calculados
            {calcularAhoraData.errores.length > 0 &&
              ` (${calcularAhoraData.errores.length} errores)`}
          </p>
          {calcularAhoraData.errores.length > 0 && (
            <ul className="mt-1 list-inside list-disc text-xs text-red-700">
              {calcularAhoraData.errores.map((e) => (
                <li key={e.indicador_id}>
                  {e.indicador_nombre}: {e.error}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {isCalcularError && (
        <div className="mb-4 rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-800">
          Error: {calcularError?.message ?? 'Error desconocido'}
        </div>
      )}

      <div className="mb-4">
        <ResultadosFilters filters={filters} onChange={handleFilterChange} />
      </div>

      <ResultadosTable
        items={data?.items ?? []}
        isLoading={isLoading}
        isError={isError}
        error={error}
        onRetry={refetch}
      />

      <Pagination
        page={page}
        size={pageSize}
        totalPages={data?.pages ?? 0}
        total={data?.total ?? 0}
        onPageChange={handlePageChange}
        onSizeChange={handleSizeChange}
        entityLabel="resultados"
      />
    </main>
  );
}
