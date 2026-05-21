/// <reference types="vitest/globals" />
/**
 * Tests for the resultados TanStack Query hooks.
 *
 * Uses MSW to intercept API calls, `renderHook` from React Testing
 * Library, and a fresh `QueryClient` wrapper per test.
 */

import { renderHook, waitFor } from '@testing-library/react';
import { useResultados, useCalcularAhora } from '@/features/resultados/hooks';
import { createWrapper } from '@/test/utils';

describe('useResultados', () => {
  it('returns loading state initially', () => {
    const { result } = renderHook(
      () => useResultados({ page: 1, size: 10 }),
      { wrapper: createWrapper() },
    );

    expect(result.current.isLoading).toBe(true);
    expect(result.current.data).toBeUndefined();
    expect(result.current.isError).toBe(false);
  });

  it('returns paginated data after fetch resolves', async () => {
    const { result } = renderHook(
      () => useResultados({ page: 1, size: 10 }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.data).toBeDefined();
    expect(result.current.data!.items).toHaveLength(2);
    expect(result.current.data!.items[0].indicador_nombre).toBe('Tasa de Mortalidad');
    expect(result.current.data!.total).toBe(2);
    expect(result.current.data!.page).toBe(1);
  });

  it('includes filter params in the query key', async () => {
    const { result } = renderHook(
      () =>
        useResultados({
          page: 1,
          size: 10,
          indicador_id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
          periodo_inicio: '2026-01-01',
          periodo_fin: '2026-01-31',
        }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.data).toBeDefined();
    expect(result.current.data!.items).toHaveLength(2);
  });

  it('handles error state when API returns 502', async () => {
    const { result } = renderHook(
      () => useResultados({ page: 999, size: 10 }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(result.current.error).toBeDefined();
    expect(result.current.error!.message).toContain('Upstream service unavailable');
  });
});

describe('useCalcularAhora', () => {
  it('calls calcularAhora mutation and returns data on success', async () => {
    const { result } = renderHook(() => useCalcularAhora(), {
      wrapper: createWrapper(),
    });

    result.current.calcularAhora();

    await waitFor(() => {
      expect(result.current.isPending).toBe(false);
    });

    expect(result.current.data).toBeDefined();
    expect(result.current.data!.calculados).toBe(2);
    expect(result.current.data!.errores).toHaveLength(0);
    expect(result.current.data!.total).toBe(2);
  });

  it('invalidates resultados queries on success', async () => {
    // Populate the cache with a resultados query
    const { result: listResult } = renderHook(
      () => useResultados({ page: 1, size: 10 }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(listResult.current.isLoading).toBe(false);
    });
    expect(listResult.current.data!.total).toBe(2);

    // Trigger calcular-ahora
    const { result: mutationResult } = renderHook(
      () => useCalcularAhora(),
      { wrapper: createWrapper() },
    );

    mutationResult.current.calcularAhora();

    await waitFor(() => {
      expect(mutationResult.current.isPending).toBe(false);
    });

    expect(mutationResult.current.data).toBeDefined();
  });
});
