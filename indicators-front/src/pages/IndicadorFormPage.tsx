import { useState, type ReactElement } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import IndicadorForm from '@/components/IndicadorForm';
import LoadingState from '@/components/LoadingState';
import ErrorState from '@/components/ErrorState';
import {
  useIndicador,
  useCreateIndicador,
  useUpdateIndicador,
} from '@/features/indicadores/hooks';
import type { IndicadorFormValues } from '@/features/indicadores/schema';
import { parseDefinicion } from '@/features/indicadores/parseDefinicion';
import { ApiRequestError } from '@/api/client';

export interface IndicadorFormPageProps {
  mode: 'create' | 'edit';
}

export default function IndicadorFormPage({
  mode,
}: IndicadorFormPageProps): ReactElement {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const {
    data: indicador,
    isLoading: isLoadingDetail,
    isError: isErrorDetail,
    error: errorDetail,
    refetch,
  } = useIndicador(mode === 'edit' ? (id ?? '') : '');

  const { createIndicador, isPending: isCreating } = useCreateIndicador();
  const { updateIndicador, isPending: isUpdating } = useUpdateIndicador();

  const [serverError, setServerError] = useState<string | null>(null);

  const isPending = isCreating || isUpdating;

  const handleSubmit = (values: IndicadorFormValues) => {
    setServerError(null);

    if (mode === 'create') {
      const payload = {
        nombre: values.nombre,
        descripcion: values.descripcion ?? null,
        definicion: {
          tipo: values.tipo,
          periodo: values.periodo,
          evento: values.evento ?? null,
          poblacion: values.poblacion,
        },
      };

      createIndicador(payload, {
        onSuccess: (data) => {
          navigate(`/indicadores/${data.id}`);
        },
        onError: (error) => {
          setServerError(error.message);
        },
      });
    } else {
      if (!id) return;
      const payload = {
        nombre: values.nombre,
        descripcion: values.descripcion ?? null,
      };

      updateIndicador(id, payload as unknown as Record<string, unknown>, {
        onSuccess: () => {
          navigate(`/indicadores/${id}`);
        },
        onError: (error) => {
          setServerError(error.message);
        },
      });
    }
  };

  if (mode === 'edit') {
    if (isLoadingDetail) {
      return (
        <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
          <LoadingState message="Cargando indicador…" />
        </main>
      );
    }

    if (isErrorDetail) {
      const is404 = errorDetail instanceof ApiRequestError && errorDetail.status === 404;
      return (
        <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
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
                : (errorDetail?.message ?? 'Error al cargar el indicador')
            }
            onRetry={is404 ? undefined : refetch}
          />
        </main>
      );
    }

    if (!indicador) {
      return (
        <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
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
  }

  const defaultValues: Partial<IndicadorFormValues> | undefined =
    mode === 'edit' && indicador
      ? {
          nombre: indicador.nombre,
          descripcion: indicador.descripcion,
          ...parseDefinicion(indicador.versiones[0]?.definicion),
        }
      : undefined;

  return (
    <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-6">
        <Link
          to="/"
          className="text-sm font-medium text-blue-600 hover:text-blue-800"
        >
          ← Volver al listado
        </Link>
      </div>

      <h1 className="mb-6 text-2xl font-bold text-gray-900">
        {mode === 'create' ? 'Nuevo indicador' : 'Editar indicador'}
      </h1>

      <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <IndicadorForm
          mode={mode}
          defaultValues={defaultValues}
          onSubmit={handleSubmit}
          serverError={serverError}
          isPending={isPending}
        />
      </div>
    </main>
  );
}
