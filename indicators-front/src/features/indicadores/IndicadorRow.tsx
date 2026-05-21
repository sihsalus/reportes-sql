/**
 * Table row for a single indicator.
 *
 * Displays indicator fields and action buttons. The "Eliminar" action
 * opens a confirmation dialog and calls the delete mutation via
 * `useDeleteIndicador`. View and Edit are placeholder actions.
 */

import { useState, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import ConfirmDialog from '@/components/ConfirmDialog';
import { useDeleteIndicador } from '@/features/indicadores/hooks';
import type { Indicador } from '@/api/types';

export interface IndicadorRowProps {
  /** The indicator to display in this row. */
  indicador: Indicador;
  /** Placeholder action: called with the indicator id when "Ver" is clicked. */
  onView?: (id: string) => void;
  /** Placeholder action: called with the indicator id when "Editar" is clicked. */
  onEdit?: (id: string) => void;
}

/**
 * Format an ISO 8601 datetime string to a locale-friendly short date.
 *
 * Example: "2026-01-15T10:30:00Z" → "15/01/2026 10:30"
 */
function formatDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) {
    return iso;
  }
  return d.toLocaleDateString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function IndicadorRow({
  indicador,
  onView,
  onEdit,
}: IndicadorRowProps): ReactElement {
  const [showConfirm, setShowConfirm] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const { deleteIndicador, isPending } = useDeleteIndicador();
  const navigate = useNavigate();

  const handleView = () => {
    if (onView) {
      onView(indicador.id);
    } else {
      navigate(`/indicadores/${indicador.id}`);
    }
  };

  const handleEdit = () => {
    if (onEdit) {
      onEdit(indicador.id);
    } else {
      console.log('Editar indicador:', indicador.id, indicador.nombre);
    }
  };

  const handleDelete = () => {
    setDeleteError(null);
    deleteIndicador(indicador.id, {
      onSuccess: () => setShowConfirm(false),
      onError: (err) => {
        setDeleteError(err.message);
      },
    });
  };

  const handleCancelDelete = () => {
    setShowConfirm(false);
    setDeleteError(null);
  };

  return (
    <>
      <tr className="border-b border-gray-200 hover:bg-gray-50">
        <td className="whitespace-nowrap px-4 py-3 text-sm font-medium text-gray-900">
          {indicador.nombre}
        </td>
        <td className="max-w-xs px-4 py-3 text-sm text-gray-600">
          <span className="line-clamp-1">
            {indicador.descripcion ?? '—'}
          </span>
        </td>
        <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600">
          <span
            className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
              indicador.activo
                ? 'bg-green-100 text-green-700'
                : 'bg-gray-100 text-gray-600'
            }`}
          >
            {indicador.activo ? 'Activo' : 'Inactivo'}
          </span>
        </td>
        <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600">
          {formatDate(indicador.creado_en)}
        </td>
        <td className="whitespace-nowrap px-4 py-3 text-sm">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleView}
              className="rounded-md px-2 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1"
              aria-label={`Ver indicador ${indicador.nombre}`}
            >
              Ver
            </button>
            <button
              type="button"
              onClick={handleEdit}
              className="rounded-md px-2 py-1 text-xs font-medium text-amber-600 hover:bg-amber-50 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-1"
              aria-label={`Editar indicador ${indicador.nombre}`}
            >
              Editar
            </button>
            <button
              type="button"
              onClick={() => setShowConfirm(true)}
              disabled={isPending}
              className="rounded-md px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-1"
              aria-label={`Eliminar indicador ${indicador.nombre}`}
            >
              Eliminar
            </button>
          </div>
        </td>
      </tr>

      <ConfirmDialog
        isOpen={showConfirm}
        title="Eliminar indicador"
        message={`¿Estás seguro de que querés eliminar "${indicador.nombre}"? Esta acción no se puede deshacer.`}
        onConfirm={handleDelete}
        onCancel={handleCancelDelete}
        isPending={isPending}
        error={deleteError}
      />
    </>
  );
}
