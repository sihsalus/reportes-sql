/**
 * Detail page for a single indicator.
 *
 * Displays:
 * 1. Metadata card with action buttons
 * 2. Current definition (prominent)
 * 3. Collapsible form to create new versions
 * 4. Compact version history (expandable per row)
 *
 * Uses TanStack Query hooks for data fetching and mutation.
 */

import { useState, type ReactElement, Fragment } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useIndicador, useCreateVersion } from '@/features/indicadores/hooks';
import { parseDefinicion } from '@/features/indicadores/parseDefinicion';
import type { IndicadorFormValues } from '@/features/indicadores/schema';
import type { DefinicionIndicadorForm } from '@/api/types';
import { ApiRequestError } from '@/api/client';
import LoadingState from '@/components/LoadingState';
import ErrorState from '@/components/ErrorState';
import DefinicionView from '@/components/DefinicionView';
import IndicadorForm from '@/components/IndicadorForm';
import SQLPreviewSection from '@/components/SQLPreviewSection';

/**
 * Format an ISO 8601 datetime string to a locale-friendly short date.
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

/**
 * Get the latest version (highest version number) from the versiones array.
 */
function getLatestVersion(
  versiones: { version: number; definicion: Record<string, unknown> }[],
): Record<string, unknown> | undefined {
  if (versiones.length === 0) return undefined;
  return versiones.reduce((max, v) => (v.version > max.version ? v : max), versiones[0])
    .definicion;
}

export default function IndicadorDetailPage(): ReactElement {
  const { id } = useParams<{ id: string }>();
  const { data, isLoading, isError, error, refetch } = useIndicador(id ?? '');
  const { createVersion, isPending } = useCreateVersion(id ?? '');

  const [showForm, setShowForm] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [expandedVersion, setExpandedVersion] = useState<string | null>(null);

  const handleToggleForm = () => {
    setShowForm((prev) => !prev);
    setServerError(null);
  };

  const handleFormSubmit = (values: IndicadorFormValues) => {
    setServerError(null);

    const definicion: DefinicionIndicadorForm = {
      tipo: values.tipo,
      periodo: values.periodo,
      evento: values.evento ?? null,
      poblacion: values.poblacion,
    };

    createVersion(definicion as unknown as Record<string, unknown>, {
      onSuccess: () => {
        setShowForm(false);
      },
      onError: (err) => {
        setServerError(err.message);
      },
    });
  };

  const toggleVersion = (versionId: string) => {
    setExpandedVersion((prev) => (prev === versionId ? null : versionId));
  };

  // Compute defaultValues from the latest version
  const latestDefinicion = data ? getLatestVersion(data.versiones) : undefined;
  const formDefaultValues: Partial<IndicadorFormValues> | undefined =
    data && latestDefinicion
      ? {
          ...parseDefinicion(latestDefinicion),
          nombre: data.nombre,
          descripcion: data.descripcion,
        }
      : undefined;

  if (isLoading) {
    return (
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <LoadingState message="Cargando indicador…" />
      </main>
    );
  }

  if (isError) {
    const is404 = error instanceof ApiRequestError && error.status === 404;
    return (
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-6">
          <Link
            to="/"
            className="text-sm font-medium text-blue-600 hover:text-blue-800"
          >
            ← Volver al listado
          </Link>
        </div>
        <ErrorState
          message={
            is404
              ? 'Indicador no encontrado'
              : (error?.message ?? 'Error al cargar el indicador')
          }
          onRetry={is404 ? undefined : refetch}
        />
      </main>
    );
  }

  if (!data) {
    return (
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-6">
          <Link
            to="/"
            className="text-sm font-medium text-blue-600 hover:text-blue-800"
          >
            ← Volver al listado
          </Link>
        </div>
        <ErrorState message="No se encontró el indicador" />
      </main>
    );
  }

  const currentDefinicion = latestDefinicion
    ? parseDefinicion(latestDefinicion)
    : undefined;

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-6">
        <Link
          to="/"
          className="text-sm font-medium text-blue-600 hover:text-blue-800"
        >
          ← Volver al listado
        </Link>
      </div>

      {/* ── Metadata card ── */}
      <section className="mb-8 rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{data.nombre}</h1>
            <p className="mt-1 text-sm text-gray-600">
              {data.descripcion ?? 'Sin descripción'}
            </p>
          </div>
          <span
            className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${
              data.activo
                ? 'bg-green-100 text-green-700'
                : 'bg-gray-100 text-gray-600'
            }`}
          >
            {data.activo ? 'Activo' : 'Inactivo'}
          </span>
        </div>
        <p className="mt-4 text-xs text-gray-500">
          Creado el {formatDate(data.creado_en)}
        </p>

        {/* Action buttons */}
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Link
            to={`/indicadores/${id}/editar`}
            className="rounded-md bg-white px-4 py-2 text-sm font-medium text-gray-700 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
          >
            ✏️ Editar indicador
          </Link>
          <button
            type="button"
            onClick={handleToggleForm}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
            aria-expanded={showForm}
            aria-controls="version-form"
          >
            {showForm ? 'Cancelar nueva versión' : 'Nueva versión'}
          </button>
        </div>
      </section>

      {/* ── Collapsible new-version form ── */}
      {showForm && (
        <section
          id="version-form"
          className="mb-8 rounded-lg border border-gray-200 bg-white p-6 shadow-sm"
        >
          <h2 className="mb-4 text-lg font-semibold text-gray-900">
            Crear nueva versión
          </h2>
          {serverError && (
            <div
              className="mb-4 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700"
              role="alert"
            >
              {serverError}
            </div>
          )}
          <IndicadorForm
            mode="version"
            defaultValues={formDefaultValues}
            onSubmit={handleFormSubmit}
            serverError={null}
            isPending={isPending}
          />
        </section>
      )}

      {/* ── Current definition (prominent) ── */}
      {currentDefinicion && (
        <section className="mb-8 rounded-lg border border-blue-200 bg-blue-50 p-6 shadow-sm">
          <h2 className="mb-4 text-lg font-semibold text-blue-900">
            📊 Definición actual
          </h2>
          <div className="rounded-md bg-white p-4">
            <DefinicionView definicion={currentDefinicion} />
          </div>
          <SQLPreviewSection indicadorId={id ?? ''} />
        </section>
      )}

      {/* ── Version history (compact) ── */}
      <section>
        <h2 className="mb-4 text-lg font-semibold text-gray-900">
          Historial de versiones
        </h2>
        {data.versiones.length === 0 ? (
          <p className="text-sm text-gray-600">No hay versiones registradas.</p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-gray-200">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th
                    scope="col"
                    className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500"
                  >
                    Versión
                  </th>
                  <th
                    scope="col"
                    className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500"
                  >
                    Fecha
                  </th>
                  <th
                    scope="col"
                    className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500"
                  >
                    Acciones
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 bg-white">
                {data.versiones.map((v) => (
                  <Fragment key={v.id}>
                    <tr className="hover:bg-gray-50">
                      <td className="whitespace-nowrap px-4 py-3 text-sm font-medium text-gray-900">
                        #{v.version}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600">
                        {formatDate(v.creado_en)}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <button
                          type="button"
                          onClick={() => toggleVersion(v.id)}
                          className="text-blue-600 hover:text-blue-800"
                        >
                          {expandedVersion === v.id
                            ? 'Ocultar definición'
                            : 'Ver definición'}
                        </button>
                      </td>
                    </tr>
                    {expandedVersion === v.id && (
                      <tr>
                        <td colSpan={3} className="px-4 py-4 bg-gray-50">
                          <DefinicionView
                            definicion={parseDefinicion(v.definicion)}
                          />
                          <SQLPreviewSection
                            indicadorId={id ?? ''}
                            versionId={v.id}
                            versionNum={v.version}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
