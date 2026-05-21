/**
 * TanStack Query hooks for the resultados domain.
 *
 * Query keys follow the convention:
 *   ['resultados', params]
 *
 * Page-level invalidation uses:
 *   queryClient.invalidateQueries({ queryKey: ['resultados'] })
 *
 * which matches ALL resultados queries regardless of params.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getResultados, calcularAhora } from '@/api/resultados';
import type {
  IndicadorResultado,
  BatchCalcularNowResponse,
  GetResultadosParams,
  PaginatedResponse,
} from '@/api/types';

/** Return type for the useResultados query hook. */
export interface UseResultadosResult {
  data: PaginatedResponse<IndicadorResultado> | undefined;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  /** Manually refetch the current query. Passed to ErrorState's onRetry. */
  refetch: () => void;
}

/**
 * Fetch a paginated page of indicator results with optional filters.
 *
 * The query key includes the full params object so changing any filter
 * or pagination parameter automatically refetches the correct data.
 */
export function useResultados(params: GetResultadosParams): UseResultadosResult {
  const { data, isLoading, isError, error, refetch } = useQuery<
    PaginatedResponse<IndicadorResultado>,
    Error
  >({
    queryKey: ['resultados', params],
    queryFn: () => getResultados(params),
    enabled: params.page >= 1 && params.size >= 1,
  });

  return { data, isLoading, isError, error, refetch };
}

/** Return type for the useCalcularAhora mutation hook. */
export interface UseCalcularAhoraResult {
  calcularAhora: () => void;
  isPending: boolean;
  data: BatchCalcularNowResponse | undefined;
  isError: boolean;
  error: Error | null;
}

/**
 * Trigger batch calculation for all active indicators.
 *
 * On success, all resultados queries are invalidated so the list
 * refreshes automatically.
 */
export function useCalcularAhora(): UseCalcularAhoraResult {
  const queryClient = useQueryClient();

  const mutation = useMutation<BatchCalcularNowResponse, Error>({
    mutationFn: () => calcularAhora(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['resultados'] });
    },
  });

  return {
    calcularAhora: () => mutation.mutate(),
    isPending: mutation.isPending,
    data: mutation.data,
    isError: mutation.isError,
    error: mutation.error,
  };
}
