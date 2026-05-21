/**
 * Main page for the indicator listing.
 *
 * Owns `page` and `pageSize` state, wires the `useIndicadores` hook
 * to the table and pagination components. The page is a pure component
 * — all data fetching and side effects live in the hook.
 */

import { useState, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { useIndicadores } from '@/features/indicadores/hooks';
import IndicadoresTable from '@/features/indicadores/IndicadoresTable';
import Pagination from '@/components/Pagination';

export default function IndicadoresPage(): ReactElement {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const { data, isLoading, isError, error, refetch } = useIndicadores(
    page,
    pageSize,
  );

  const handlePageChange = (newPage: number) => {
    setPage(newPage);
  };

  const handleSizeChange = (newSize: number) => {
    setPageSize(newSize);
    setPage(1);
  };

  const handleEdit = (id: string) => {
    navigate(`/indicadores/${id}/editar`);
  };

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Indicadores</h1>
        <button
          type="button"
          onClick={() => navigate('/indicadores/nuevo')}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
        >
          Nuevo indicador
        </button>
      </div>

      <IndicadoresTable
        items={data?.items ?? []}
        isLoading={isLoading}
        isError={isError}
        error={error}
        onRetry={refetch}
        onEdit={handleEdit}
      />

      <Pagination
        page={page}
        size={pageSize}
        totalPages={data?.pages ?? 0}
        total={data?.total ?? 0}
        onPageChange={handlePageChange}
        onSizeChange={handleSizeChange}
      />
    </main>
  );
}
