import type { ReactElement } from 'react';

/**
 * Pagination controls: prev/next buttons, page info, and page-size selector.
 *
 * Fully controlled component — the parent owns page/size state and
 * passes `onPageChange` / `onSizeChange` callbacks.
 *
 * Supported page sizes: 10, 25, 50.
 */

export interface PaginationProps {
  /** Current page number (1-indexed). */
  page: number;
  /** Items per page. */
  size: number;
  /** Total number of pages. */
  totalPages: number;
  /** Total number of items across all pages. */
  total: number;
  /** Called when the user clicks Prev or Next. */
  onPageChange: (page: number) => void;
  /** Called when the user selects a different page size. */
  onSizeChange: (size: number) => void;
  /** Optional label for the entity being paginated (default: "indicadores"). */
  entityLabel?: string;
}

const PAGE_SIZES = [10, 25, 50] as const;

export default function Pagination({
  page,
  size,
  totalPages,
  total,
  onPageChange,
  onSizeChange,
  entityLabel = 'indicadores',
}: PaginationProps): ReactElement {
  const isFirstPage = page <= 1;
  const isLastPage = page >= totalPages;

  const startItem = total === 0 ? 0 : (page - 1) * size + 1;
  const endItem = Math.min(page * size, total);

  return (
    <nav
      className="flex flex-wrap items-center justify-between gap-4 border-t border-gray-200 px-4 py-3"
      aria-label="Paginación"
    >
      <div className="text-sm text-gray-600">
        Mostrando{' '}
        <span className="font-medium">
          {startItem}–{endItem}
        </span>{' '}
        de <span className="font-medium">{total}</span> {entityLabel}
      </div>

      <div className="flex items-center gap-3">
        <label htmlFor="page-size" className="text-sm text-gray-600">
          Por página:
        </label>
        <select
          id="page-size"
          value={size}
          onChange={(e) => onSizeChange(Number(e.target.value))}
          className="rounded-md border border-gray-300 bg-white px-2 py-1 text-sm text-gray-700 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          aria-label={`Cantidad de ${entityLabel} por página`}
        >
          {PAGE_SIZES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onPageChange(page - 1)}
            disabled={isFirstPage}
            className="rounded-md border border-gray-300 bg-white px-3 py-1 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="Página anterior"
          >
            Anterior
          </button>

          <span className="px-2 text-sm text-gray-700">
            Pág. {page} de {totalPages || 1}
          </span>

          <button
            type="button"
            onClick={() => onPageChange(page + 1)}
            disabled={isLastPage}
            className="rounded-md border border-gray-300 bg-white px-3 py-1 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="Página siguiente"
          >
            Siguiente
          </button>
        </div>
      </div>
    </nav>
  );
}
