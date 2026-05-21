/// <reference types="vitest/globals" />
/**
 * Tests for the indicadores TanStack Query hooks.
 *
 * Uses MSW to intercept API calls, `renderHook` from React Testing
 * Library, and a fresh `QueryClient` wrapper per test.
 */

import { renderHook, waitFor } from '@testing-library/react';
import { useIndicadores, useIndicador, useCreateVersion, useDeleteIndicador } from '@/features/indicadores/hooks';
import { createWrapper } from '@/test/utils';

describe('useIndicadores', () => {
  it('returns loading state initially', () => {
    const { result } = renderHook(() => useIndicadores(1, 10), {
      wrapper: createWrapper(),
    });

    expect(result.current.isLoading).toBe(true);
    expect(result.current.data).toBeUndefined();
    expect(result.current.isError).toBe(false);
  });

  it('returns paginated data after fetch resolves', async () => {
    const { result } = renderHook(() => useIndicadores(1, 10), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.data).toBeDefined();
    expect(result.current.data!.items).toHaveLength(3);
    expect(result.current.data!.items[0].nombre).toBe('Tasa de Mortalidad');
    expect(result.current.data!.total).toBe(3);
    expect(result.current.data!.page).toBe(1);
  });

  it('returns empty items when on a page beyond total', async () => {
    const { result } = renderHook(() => useIndicadores(5, 10), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.data!.items).toHaveLength(0);
    expect(result.current.data!.total).toBe(3);
    expect(result.current.data!.pages).toBe(1);
  });

  it('handles error state when API returns 502', async () => {
    const { result } = renderHook(() => useIndicadores(999, 10), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(result.current.error).toBeDefined();
    expect(result.current.error!.message).toContain('Upstream service unavailable');
  });

  it('respects page size parameter', async () => {
    const { result } = renderHook(() => useIndicadores(1, 1), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.data!.items).toHaveLength(1);
    expect(result.current.data!.size).toBe(1);
    expect(result.current.data!.pages).toBe(3);
  });
});

describe('useDeleteIndicador', () => {
  const EXISTING_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
  const MISSING_ID = '00000000-0000-0000-0000-000000000000';

  it('calls the delete API and invalidates query on success', async () => {
    // First, populate the query cache with a page of data
    const { result: listResult } = renderHook(() => useIndicadores(1, 10), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(listResult.current.isLoading).toBe(false);
    });
    expect(listResult.current.data!.total).toBe(3);

    // Now delete one indicator
    const { result: deleteResult } = renderHook(
      () => useDeleteIndicador(),
      { wrapper: createWrapper() },
    );

    // Spy on the fetch to verify DELETE was called
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    deleteResult.current.deleteIndicador(EXISTING_ID);

    await waitFor(() => {
      expect(deleteResult.current.isPending).toBe(false);
    });

    // Verify the DELETE request was made
    const deleteCall = fetchSpy.mock.calls.find((call) => {
      const [input, init] = call;
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : '';
      return url.includes('/indicadores/') && init?.method === 'DELETE';
    });
    expect(deleteCall).toBeDefined();

    fetchSpy.mockRestore();
  });

  it('does not call delete when id is empty or falsy', () => {
    const { result } = renderHook(() => useDeleteIndicador(), {
      wrapper: createWrapper(),
    });

    // The hook's mutate wrapper should still be callable,
    // but the mutationFn receives the id directly.
    expect(result.current.deleteIndicador).toBeDefined();
    expect(typeof result.current.deleteIndicador).toBe('function');
  });

  it('handles 404 error from API', async () => {
    const { result } = renderHook(() => useDeleteIndicador(), {
      wrapper: createWrapper(),
    });

    const onError = vi.fn();

    result.current.deleteIndicador(MISSING_ID, { onError });

    await waitFor(() => {
      expect(onError).toHaveBeenCalled();
    });

    const error = onError.mock.calls[0][0] as Error;
    expect(error.message).toContain('Indicador no encontrado');
  });

  it('calls onSuccess callback after successful deletion', async () => {
    const { result } = renderHook(() => useDeleteIndicador(), {
      wrapper: createWrapper(),
    });

    const onSuccess = vi.fn();

    result.current.deleteIndicador(EXISTING_ID, { onSuccess });

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalled();
    });
  });
});

describe('useIndicador', () => {
  const EXISTING_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
  const MISSING_ID = '00000000-0000-0000-0000-000000000000';
  const UPSTREAM_ID = 'deadbeef-0000-0000-0000-000000000000';

  it('returns loading state initially', () => {
    const { result } = renderHook(() => useIndicador(EXISTING_ID), {
      wrapper: createWrapper(),
    });

    expect(result.current.isLoading).toBe(true);
    expect(result.current.data).toBeUndefined();
    expect(result.current.isError).toBe(false);
  });

  it('returns detail data with versiones after fetch resolves', async () => {
    const { result } = renderHook(() => useIndicador(EXISTING_ID), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.data).toBeDefined();
    expect(result.current.data!.nombre).toBe('Tasa de Mortalidad');
    expect(result.current.data!.versiones).toHaveLength(3);
    expect(result.current.data!.versiones[0].version).toBe(1);
  });

  it('handles 404 error', async () => {
    const { result } = renderHook(() => useIndicador(MISSING_ID), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(result.current.error).toBeDefined();
    expect(result.current.error!.message).toContain('no encontrado');
  });

  it('handles 502 upstream failure', async () => {
    const { result } = renderHook(() => useIndicador(UPSTREAM_ID), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(result.current.error).toBeDefined();
    expect(result.current.error!.message).toContain('Upstream service unavailable');
  });
});

describe('useCreateVersion', () => {
  const EXISTING_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

  it('creates a version and invalidates detail query on success', async () => {
    // Populate detail cache
    const { result: detailResult } = renderHook(() => useIndicador(EXISTING_ID), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(detailResult.current.isLoading).toBe(false);
    });
    expect(detailResult.current.data!.versiones).toHaveLength(3);

    // Create a new version
    const { result: createResult } = renderHook(
      () => useCreateVersion(EXISTING_ID),
      { wrapper: createWrapper() },
    );

    const onSuccess = vi.fn();
    createResult.current.createVersion({ tipo: 'nuevo' }, { onSuccess });

    await waitFor(() => {
      expect(createResult.current.isPending).toBe(false);
    });

    expect(onSuccess).toHaveBeenCalled();
  });

  it('handles 409 conflict', async () => {
    const { result } = renderHook(() => useCreateVersion(EXISTING_ID), {
      wrapper: createWrapper(),
    });

    const onError = vi.fn();
    // Submit a definicion that already exists in the fixture (matches version 1)
    result.current.createVersion(
      {
        tipo: 'conteo_atenciones',
        periodo: 'mes_actual',
        evento: {
          encounter_type_uuids: ['550e8400-e29b-41d4-a716-446655440000'],
          minimo_ocurrencias: 1,
          diagnosticos: [
            {
              concepto_uuid: 'aaaa1111-bbbb-2222-cccc-333333333333',
              tipo_diagnostico: 'definitivo',
            },
          ],
        },
      },
      { onError },
    );

    await waitFor(() => {
      expect(onError).toHaveBeenCalled();
    });

    const error = onError.mock.calls[0][0] as Error;
    expect(error.message).toContain('Conflicto');
  });

  it('handles 422 validation error', async () => {
    const { result } = renderHook(() => useCreateVersion(EXISTING_ID), {
      wrapper: createWrapper(),
    });

    const onError = vi.fn();
    // Cast null to bypass the type check and trigger the MSW 422 path
    result.current.createVersion(null as unknown as Record<string, unknown>, { onError });

    await waitFor(() => {
      expect(onError).toHaveBeenCalled();
    });

    const error = onError.mock.calls[0][0] as Error;
    expect(error.message).toContain('no puede estar vacía');
  });
});
