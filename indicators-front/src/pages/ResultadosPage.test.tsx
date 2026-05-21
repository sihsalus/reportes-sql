/// <reference types="vitest/globals" />
/**
 * Integration tests for ResultadosPage.
 *
 * Verifies filters, calcular-ahora button, banner, and error states.
 */

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import ResultadosPage from '@/pages/ResultadosPage';
import { server } from '@/test/server';
import type { IndicadorResultado, PaginatedResponse } from '@/api/types';

function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = createTestQueryClient();
  return render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
    </MemoryRouter>,
  );
}

const defaultResultados: PaginatedResponse<IndicadorResultado> = {
  items: [
    {
      id: 'r1a1b2c3-d4e5-f678-90ab-cdef12345678',
      indicador_version_id: 'v1a1b2c3-d4e5-f678-90ab-cdef12345678',
      indicador_nombre: 'Tasa de Mortalidad',
      indicador_version_num: 1,
      periodo_inicio: '2026-01-01',
      periodo_fin: '2026-01-31',
      valor: 4.2,
      calculado_en: '2026-02-01T10:00:00Z',
    },
    {
      id: 'r2a1b2c3-d4e5-f678-90ab-cdef12345679',
      indicador_version_id: 'v2a1b2c3-d4e5-f678-90ab-cdef12345679',
      indicador_nombre: 'Cobertura de Vacunación',
      indicador_version_num: 2,
      periodo_inicio: '2026-02-01',
      periodo_fin: '2026-02-28',
      valor: 87.5,
      calculado_en: '2026-03-01T10:00:00Z',
    },
  ],
  total: 2,
  page: 1,
  size: 10,
  pages: 1,
};

describe('ResultadosPage', () => {
  it('renders resultados table with rows', async () => {
    renderWithProviders(<ResultadosPage />);

    await waitFor(() => {
      expect(
        screen.getByRole('table', { name: /listado de resultados/i }),
      ).toBeInTheDocument();
    });

    const table = screen.getByRole('table', { name: /listado de resultados/i });
    expect(within(table).getByText('Tasa de Mortalidad')).toBeInTheDocument();
    expect(within(table).getByText('Cobertura de Vacunación')).toBeInTheDocument();
  });

  it('filters by indicator and refreshes table', async () => {
    renderWithProviders(<ResultadosPage />);

    await waitFor(() => {
      expect(screen.getByText('Tasa de Mortalidad')).toBeInTheDocument();
    });

    server.use(
      http.get('/resultados/', ({ request }) => {
        const url = new URL(request.url);
        const indicador_id = url.searchParams.get('indicador_id');
        if (indicador_id === 'b2c3d4e5-f6a7-8901-bcde-f12345678901') {
          const filtered: PaginatedResponse<IndicadorResultado> = {
            items: [
              {
                id: 'r2a1b2c3-d4e5-f678-90ab-cdef12345679',
                indicador_version_id: 'v2a1b2c3-d4e5-f678-90ab-cdef12345679',
                indicador_nombre: 'Cobertura de Vacunación',
                indicador_version_num: 2,
                periodo_inicio: '2026-02-01',
                periodo_fin: '2026-02-28',
                valor: 87.5,
                calculado_en: '2026-03-01T10:00:00Z',
              },
            ],
            total: 1,
            page: 1,
            size: 10,
            pages: 1,
          };
          return HttpResponse.json(filtered);
        }
        return HttpResponse.json(defaultResultados);
      }),
    );

    const select = screen.getByRole('combobox', {
      name: /filtrar por indicador/i,
    });
    await userEvent.selectOptions(
      select,
      'b2c3d4e5-f6a7-8901-bcde-f12345678901',
    );

    const table = screen.getByRole('table', { name: /listado de resultados/i });
    await waitFor(() => {
      expect(
        within(table).queryByText('Tasa de Mortalidad'),
      ).not.toBeInTheDocument();
    });
    expect(within(table).getByText('Cobertura de Vacunación')).toBeInTheDocument();
    expect(within(table).getByText('87,5')).toBeInTheDocument();
  });

  it('shows calcular-ahora button and displays success banner on click', async () => {
    renderWithProviders(<ResultadosPage />);

    await waitFor(() => {
      expect(screen.getByRole('table')).toBeInTheDocument();
    });

    const button = screen.getByRole('button', { name: /calcular ahora/i });
    expect(button).toBeInTheDocument();

    await userEvent.click(button);

    await waitFor(() => {
      expect(screen.getByText(/2 indicadores calculados/i)).toBeInTheDocument();
    });

    expect(
      screen.getByText(/2 indicadores calculados/i).closest('div'),
    ).toHaveClass('bg-green-50');
  });

  it('shows error banner when calcular-ahora returns errors', async () => {
    server.use(
      http.post('/resultados/calcular-ahora', async () => {
        return HttpResponse.json({
          calculados: 1,
          errores: [
            {
              indicador_id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
              indicador_nombre: 'Tasa de Mortalidad',
              error: 'BOOM',
            },
          ],
          total: 2,
        });
      }),
    );

    renderWithProviders(<ResultadosPage />);

    await waitFor(() => {
      expect(screen.getByRole('table')).toBeInTheDocument();
    });

    const button = screen.getByRole('button', { name: /calcular ahora/i });
    await userEvent.click(button);

    await waitFor(() => {
      expect(screen.getByText(/1 indicadores calculados/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/1 errores/i)).toBeInTheDocument();
    expect(screen.getByText(/Tasa de Mortalidad: BOOM/i)).toBeInTheDocument();
  });

  it('shows network error banner on calcular-ahora failure', async () => {
    server.use(
      http.post('/resultados/calcular-ahora', () => {
        return HttpResponse.json(
          { detail: 'Upstream service unavailable' },
          { status: 502 },
        );
      }),
    );

    renderWithProviders(<ResultadosPage />);

    await waitFor(() => {
      expect(screen.getByRole('table')).toBeInTheDocument();
    });

    const button = screen.getByRole('button', { name: /calcular ahora/i });
    await userEvent.click(button);

    await waitFor(() => {
      expect(
        screen.getByText(/upstream service unavailable/i),
      ).toBeInTheDocument();
    });
  });
});
