/// <reference types="vitest/globals" />
/**
 * Tests for the ResultadosFilters component.
 *
 * Verifies that selecting an indicator or changing dates
 * invokes the onChange callback with the correct filter values.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/server';
import ResultadosFilters from '@/features/resultados/ResultadosFilters';
import type { ResultadosFilters as ResultadosFiltersType } from '@/api/types';

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

describe('ResultadosFilters', () => {
  it('calls onChange with indicador_id when selecting an indicator', async () => {
    const onChange = vi.fn();
    const filters: ResultadosFiltersType = {};

    render(<ResultadosFilters filters={filters} onChange={onChange} />, {
      wrapper: createWrapper(),
    });

    // Wait for indicadores to load and options to appear
    await waitFor(() => {
      const select = screen.getByRole('combobox', { name: /filtrar por indicador/i });
      expect(select).not.toBeDisabled();
    });

    const select = screen.getByRole('combobox', { name: /filtrar por indicador/i });
    await userEvent.selectOptions(select, 'a1b2c3d4-e5f6-7890-abcd-ef1234567890');

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        indicador_id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      }),
    );
  });

  it('calls onChange with periodo_inicio when changing desde date', async () => {
    const onChange = vi.fn();
    const filters: ResultadosFiltersType = {};

    render(<ResultadosFilters filters={filters} onChange={onChange} />, {
      wrapper: createWrapper(),
    });

    const input = await screen.findByLabelText(/desde/i);
    await userEvent.clear(input);
    await userEvent.type(input, '2026-01-01');

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        periodo_inicio: '2026-01-01',
      }),
    );
  });

  it('calls onChange with periodo_fin when changing hasta date', async () => {
    const onChange = vi.fn();
    const filters: ResultadosFiltersType = {};

    render(<ResultadosFilters filters={filters} onChange={onChange} />, {
      wrapper: createWrapper(),
    });

    const input = await screen.findByLabelText(/hasta/i);
    await userEvent.clear(input);
    await userEvent.type(input, '2026-01-31');

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        periodo_fin: '2026-01-31',
      }),
    );
  });

  it('renders all indicators in the dropdown', async () => {
    const onChange = vi.fn();
    const filters: ResultadosFiltersType = {};

    render(<ResultadosFilters filters={filters} onChange={onChange} />, {
      wrapper: createWrapper(),
    });

    // Wait for indicadores to load and options to appear
    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'Tasa de Mortalidad' })).toBeInTheDocument();
    });

    const select = screen.getByRole('combobox', { name: /filtrar por indicador/i });
    const options = screen.getAllByRole('option');

    expect(options[0]).toHaveValue('');
    expect(options[0]).toHaveTextContent('Todos');

    expect(select).toContainElement(screen.getByRole('option', { name: 'Tasa de Mortalidad' }));
    expect(select).toContainElement(screen.getByRole('option', { name: 'Cobertura de Vacunación' }));
    expect(select).toContainElement(screen.getByRole('option', { name: 'Tasa de Natalidad' }));
  });

  it('shows ErrorState with "Error del servidor" and retry button when indicadores 502', async () => {
    // Override MSW handler to return 502 for the indicadores list
    server.use(
      http.get('/indicadores/', () =>
        HttpResponse.json(
          { detail: 'Upstream service unavailable' },
          { status: 502 },
        ),
      ),
    );

    const onChange = vi.fn();
    const filters: ResultadosFiltersType = {};

    render(<ResultadosFilters filters={filters} onChange={onChange} />, {
      wrapper: createWrapper(),
    });

    // Verify ErrorState is shown with the server error message
    await waitFor(() => {
      expect(screen.getByText('Error del servidor')).toBeInTheDocument();
    });

    // Verify the retry button is visible
    const retryButton = screen.getByRole('button', {
      name: /reintentar la carga de datos/i,
    });
    expect(retryButton).toBeInTheDocument();
  });
});
