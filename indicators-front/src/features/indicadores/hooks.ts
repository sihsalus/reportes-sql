/**
 * TanStack Query hooks for the indicadores domain.
 *
 * Query keys follow the convention:
 *   ['indicadores', { page, size }]
 *
 * Page-level invalidation uses:
 *   queryClient.invalidateQueries({ queryKey: ['indicadores'] })
 *
 * which matches ALL indicadores queries regardless of page/size params.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, useEffect } from 'react';
import {
  getIndicadores,
  getIndicador,
  createVersion,
  deleteIndicador,
  createIndicador,
  updateIndicador,
  getEncounterTypes,
  searchDiagnosticos,
  searchLocations,
  searchConceptos,
} from '@/api/indicadores';
import type {
  Indicador,
  IndicadorCreatePayload,
  IndicadorDetail,
  IndicadorUpdatePayload,
  IndicadorVersion,
  EncounterTypeOption,
  DiagnosticoOption,
  LocationOption,
  OrdenOption,
  PaginatedResponse,
} from '@/api/types';

/** Return type for the useIndicadores query hook. */
export interface UseIndicadoresResult {
  data: PaginatedResponse<Indicador> | undefined;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  /** Manually refetch the current query. Passed to ErrorState's onRetry. */
  refetch: () => void;
}

/**
 * Fetch a paginated page of active indicators.
 *
 * Query is enabled only when both page and size are valid positive numbers.
 * The query key includes { page, size } so changing pagination
 * parameters automatically refetches the correct page.
 */
export function useIndicadores(page: number, size: number): UseIndicadoresResult {
  const { data, isLoading, isError, error, refetch } = useQuery<
    PaginatedResponse<Indicador>,
    Error
  >({
    queryKey: ['indicadores', { page, size }],
    queryFn: () => getIndicadores(page, size),
    enabled: page >= 1 && size >= 1,
  });

  return { data, isLoading, isError, error, refetch };
}

/**
 * Mutation callbacks for the delete operation.
 *
 * Kept minimal — consumers only need onSuccess (to close dialogs, etc.)
 * and onError (to show toasts). The hook itself handles query invalidation.
 */
export interface DeleteIndicadorCallbacks {
  onSuccess?: () => void;
  onError?: (error: Error) => void;
}

/** Return type for the useDeleteIndicador mutation hook. */
export interface UseDeleteIndicadorResult {
  /** Mutation function — accepts an id and optional callbacks. */
  deleteIndicador: (id: string, callbacks?: DeleteIndicadorCallbacks) => void;
  isPending: boolean;
  isError: boolean;
  error: Error | null;
}

/** Return type for the useIndicador query hook. */
export interface UseIndicadorResult {
  data: IndicadorDetail | undefined;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => void;
}

/**
 * Fetch a single indicator with its full version history.
 *
 * Query key: `['indicadores', id]` — matches the list prefix so broad
 * invalidation (`['indicadores']`) refreshes both list and detail.
 * Disabled when `id` is empty or falsy.
 */
export function useIndicador(id: string): UseIndicadorResult {
  const { data, isLoading, isError, error, refetch } = useQuery<
    IndicadorDetail,
    Error
  >({
    queryKey: ['indicadores', id],
    queryFn: () => getIndicador(id),
    enabled: !!id,
  });

  return { data, isLoading, isError, error, refetch };
}

/** Mutation callbacks for the create version operation. */
export interface CreateVersionCallbacks {
  onSuccess?: () => void;
  onError?: (error: Error) => void;
}

/** Return type for the useCreateVersion mutation hook. */
export interface UseCreateVersionResult {
  createVersion: (definicion: Record<string, unknown>, callbacks?: CreateVersionCallbacks) => void;
  isPending: boolean;
  isError: boolean;
  error: Error | null;
}

/**
 * Create a new version for an indicator and invalidate the detail query.
 *
 * On success, the detail query (`['indicadores', id]`) is invalidated
 * so the version history refreshes automatically.
 */
export function useCreateVersion(id: string): UseCreateVersionResult {
  const queryClient = useQueryClient();

  const mutation = useMutation<IndicadorVersion, Error, Record<string, unknown>>({
    mutationFn: (definicion: Record<string, unknown>) => createVersion(id, definicion),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['indicadores', id] });
    },
  });

  return {
    createVersion: (definicion: Record<string, unknown>, callbacks?: CreateVersionCallbacks) => {
      mutation.mutate(definicion, {
        onSuccess: callbacks?.onSuccess,
        onError: callbacks?.onError,
      });
    },
    isPending: mutation.isPending,
    isError: mutation.isError,
    error: mutation.error,
  };
}

/**
 * Soft-delete an indicator and invalidate the list.
 *
 * On success, all indicadores queries are invalidated so the list
 * refetches automatically. The mutation does NOT use optimistic updates
 * because the soft-delete may need server-side validation first.
 */
export function useDeleteIndicador(): UseDeleteIndicadorResult {
  const queryClient = useQueryClient();

  const mutation = useMutation<void, Error, string>({
    mutationFn: (id: string) => deleteIndicador(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['indicadores'] });
    },
  });

  return {
    deleteIndicador: (id: string, callbacks?: DeleteIndicadorCallbacks) => {
      mutation.mutate(id, {
        onSuccess: callbacks?.onSuccess,
        onError: callbacks?.onError,
      });
    },
    isPending: mutation.isPending,
    isError: mutation.isError,
    error: mutation.error,
  };
}

/** Mutation callbacks for create indicator. */
export interface CreateIndicadorCallbacks {
  onSuccess?: (data: Indicador) => void;
  onError?: (error: Error) => void;
}

/** Return type for useCreateIndicador mutation hook. */
export interface UseCreateIndicadorResult {
  createIndicador: (data: IndicadorCreatePayload, callbacks?: CreateIndicadorCallbacks) => void;
  isPending: boolean;
  isError: boolean;
  error: Error | null;
}

/**
 * Create a new indicator and invalidate the list.
 *
 * On success, all indicadores queries are invalidated so the list
 * refreshes automatically.
 */
export function useCreateIndicador(): UseCreateIndicadorResult {
  const queryClient = useQueryClient();

  const mutation = useMutation<Indicador, Error, IndicadorCreatePayload>({
    mutationFn: (data: IndicadorCreatePayload) => createIndicador(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['indicadores'] });
    },
  });

  return {
    createIndicador: (data: IndicadorCreatePayload, callbacks?: CreateIndicadorCallbacks) => {
      mutation.mutate(data, {
        onSuccess: callbacks?.onSuccess,
        onError: callbacks?.onError,
      });
    },
    isPending: mutation.isPending,
    isError: mutation.isError,
    error: mutation.error,
  };
}

/** Mutation callbacks for update indicator. */
export interface UpdateIndicadorCallbacks {
  onSuccess?: (data: Indicador) => void;
  onError?: (error: Error) => void;
}

/** Return type for useUpdateIndicador mutation hook. */
export interface UseUpdateIndicadorResult {
  updateIndicador: (id: string, data: IndicadorUpdatePayload, callbacks?: UpdateIndicadorCallbacks) => void;
  isPending: boolean;
  isError: boolean;
  error: Error | null;
}

/**
 * Update an indicator's metadata and invalidate related queries.
 */
export function useUpdateIndicador(): UseUpdateIndicadorResult {
  const queryClient = useQueryClient();

  const mutation = useMutation<Indicador, Error, { id: string; data: IndicadorUpdatePayload }>({
    mutationFn: ({ id, data }) => updateIndicador(id, data),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['indicadores'] });
      queryClient.invalidateQueries({ queryKey: ['indicadores', variables.id] });
    },
  });

  return {
    updateIndicador: (id: string, data: IndicadorUpdatePayload, callbacks?: UpdateIndicadorCallbacks) => {
      mutation.mutate({ id, data }, {
        onSuccess: callbacks?.onSuccess,
        onError: callbacks?.onError,
      });
    },
    isPending: mutation.isPending,
    isError: mutation.isError,
    error: mutation.error,
  };
}

/** Return type for useEncounterTypes query hook. */
export interface UseEncounterTypesResult {
  data: EncounterTypeOption[] | undefined;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
}

/**
 * Fetch all encounter types from OpenMRS.
 */
export function useEncounterTypes(): UseEncounterTypesResult {
  const { data, isLoading, isError, error } = useQuery<EncounterTypeOption[], Error>({
    queryKey: ['encounter-types'],
    queryFn: () => getEncounterTypes(),
  });

  return { data, isLoading, isError, error };
}

// ── Debounce hook ──────────────────────────────────────────────────────

/**
 * Debounce a value by the specified delay in milliseconds.
 *
 * The debounced value only updates after `delay` ms of inactivity.
 * Used to delay search queries until the user stops typing.
 */
export function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debouncedValue;
}

// ── Diagnóstico search hook ────────────────────────────────────────────

/** Return type for useDiagnosticoSearch query hook. */
export interface UseDiagnosticoSearchResult {
  data: DiagnosticoOption[] | undefined;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
}

/**
 * Search diagnosis concepts via OpenMRS proxy with debounce control.
 *
 * Query is enabled only when the input has 2+ characters,
 * preventing premature requests on short or empty inputs.
 * The debounce should be applied OUTSIDE this hook — pass the
 * already-debounced value as `query`.
 */
export function useDiagnosticoSearch(query: string): UseDiagnosticoSearchResult {
  const { data, isLoading, isError, error } = useQuery<DiagnosticoOption[], Error>({
    queryKey: ['diagnosticos', query],
    queryFn: () => searchDiagnosticos(query),
    enabled: query.trim().length >= 2,
    staleTime: 60_000, // 1-minute cache for repeated searches
  });

  return { data, isLoading, isError, error };
}

// ── Concept search hook ──────────────────────────────────────────────

/** Return type for useConceptoSearch query hook. */
export interface UseConceptoSearchResult {
  data: OrdenOption[] | undefined;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
}

/**
 * Search concepts by class and query via OpenMRS proxy with debounce control.
 *
 * Query is enabled only when the input has 2+ characters.
 * The debounce should be applied OUTSIDE this hook — pass the
 * already-debounced value as `query`.
 */
export function useConceptoSearch(query: string, clase: string): UseConceptoSearchResult {
  const { data, isLoading, isError, error } = useQuery<OrdenOption[], Error>({
    queryKey: ['conceptos', clase, query],
    queryFn: () => searchConceptos(query, clase),
    enabled: query.trim().length >= 2,
    staleTime: 60_000,
  });

  return { data, isLoading, isError, error };
}

// ── Location search hook ─────────────────────────────────────────────

/** Return type for useLocationSearch query hook. */
export interface UseLocationSearchResult {
  data: LocationOption[] | undefined;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
}

/**
 * Search locations via OpenMRS proxy with debounce control.
 *
 * Query is enabled only when the input has 2+ characters,
 * preventing premature requests on short or empty inputs.
 * The debounce should be applied OUTSIDE this hook — pass the
 * already-debounced value as `query`.
 */
export function useLocationSearch(query: string): UseLocationSearchResult {
  const { data, isLoading, isError, error } = useQuery<LocationOption[], Error>({
    queryKey: ['locations', query],
    queryFn: () => searchLocations(query),
    enabled: query.trim().length >= 2,
    staleTime: 60_000, // 1-minute cache for repeated searches
  });

  return { data, isLoading, isError, error };
}
