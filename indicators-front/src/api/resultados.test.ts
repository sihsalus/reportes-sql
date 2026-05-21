/// <reference types="vitest/globals" />
/**
 * Unit tests for the resultados API client.
 *
 * Mocks the underlying typed client to verify URL construction
 * and parameter passing without hitting the network.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getResultados, calcularAhora } from './resultados';
import { apiGet, apiPost } from './client';

vi.mock('./client', () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
}));

describe('resultados API', () => {
  beforeEach(() => {
    vi.mocked(apiGet).mockClear();
    vi.mocked(apiPost).mockClear();
  });
  it('getResultados calls apiGet with correct path and params', async () => {
    const mockApiGet = vi.mocked(apiGet).mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      size: 10,
      pages: 0,
    });

    await getResultados({ page: 2, size: 25 });

    expect(mockApiGet).toHaveBeenCalledTimes(1);
    expect(mockApiGet).toHaveBeenCalledWith('/resultados/', { page: 2, size: 25 });
  });

  it('getResultados passes filter params when provided', async () => {
    const mockApiGet = vi.mocked(apiGet).mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      size: 10,
      pages: 0,
    });

    await getResultados({
      page: 1,
      size: 10,
      indicador_id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      periodo_inicio: '2026-01-01',
      periodo_fin: '2026-01-31',
    });

    expect(mockApiGet).toHaveBeenCalledTimes(1);
    expect(mockApiGet).toHaveBeenCalledWith('/resultados/', {
      page: 1,
      size: 10,
      indicador_id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      periodo_inicio: '2026-01-01',
      periodo_fin: '2026-01-31',
    });
  });

  it('calcularAhora calls apiPost with correct path and empty body', async () => {
    const mockApiPost = vi.mocked(apiPost).mockResolvedValue({
      calculados: 2,
      errores: [],
      total: 2,
    });

    await calcularAhora();

    expect(mockApiPost).toHaveBeenCalledTimes(1);
    expect(mockApiPost).toHaveBeenCalledWith('/resultados/calcular-ahora', {});
  });
});
