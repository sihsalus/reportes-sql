/// <reference types="vitest/globals" />
/**
 * Tests for the IndicadoresTable component.
 *
 * Verifies rendering of rows, empty state, loading state, and error state.
 * Uses MSW for API mocking where needed and React Testing Library for
 * component rendering.
 */

import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import IndicadoresTable from '@/features/indicadores/IndicadoresTable';
import type { Indicador } from '@/api/types';

/** Props for the wrapper used in tests that render IndicadorRow (which uses hooks). */
function QueryWrapper({ children }: { children: React.ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return (
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </MemoryRouter>
  );
}

/** Reusable fixture data. */
const mockIndicadores: Indicador[] = [
  {
    id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    nombre: 'Tasa de Mortalidad',
    descripcion: 'Mortalidad general',
    activo: true,
    creado_en: '2026-01-15T10:30:00Z',
  },
  {
    id: 'b2c3d4e5-f6a7-8901-bcde-f12345678901',
    nombre: 'Cobertura de Vacunación',
    descripcion: null,
    activo: true,
    creado_en: '2026-02-20T14:00:00Z',
  },
  {
    id: 'c3d4e5f6-a7b8-9012-cdef-123456789012',
    nombre: 'Tasa de Natalidad',
    descripcion: 'Nacimientos por cada 1000 habitantes',
    activo: false,
    creado_en: '2026-03-10T08:45:00Z',
  },
];

describe('IndicadoresTable', () => {
  it('renders a table with indicator rows', () => {
    render(
      <QueryWrapper>
        <IndicadoresTable
          items={mockIndicadores}
          isLoading={false}
          isError={false}
          error={null}
        />
      </QueryWrapper>,
    );

    // Check table is present with accessible label
    const table = screen.getByRole('table', {
      name: 'Listado de indicadores',
    });
    expect(table).toBeInTheDocument();

    // Check column headers
    expect(
      screen.getByRole('columnheader', { name: 'Nombre' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('columnheader', { name: 'Descripción' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('columnheader', { name: 'Estado' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('columnheader', { name: 'Creado' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('columnheader', { name: 'Acciones' }),
    ).toBeInTheDocument();

    // Check all rows are rendered
    const rows = screen.getAllByRole('row');
    // 1 header row + 3 data rows = 4 rows
    expect(rows).toHaveLength(4);

    // Check indicator names are in the table
    expect(screen.getByText('Tasa de Mortalidad')).toBeInTheDocument();
    expect(screen.getByText('Cobertura de Vacunación')).toBeInTheDocument();
    expect(screen.getByText('Tasa de Natalidad')).toBeInTheDocument();

    // Check status badges — 2 active, 1 inactive
    expect(screen.getAllByText('Activo')).toHaveLength(2);
    expect(screen.getByText('Inactivo')).toBeInTheDocument();

    // Check action buttons exist
    const verButtons = screen.getAllByText('Ver');
    const editarButtons = screen.getAllByText('Editar');
    const eliminarButtons = screen.getAllByText('Eliminar');
    expect(verButtons).toHaveLength(3);
    expect(editarButtons).toHaveLength(3);
    expect(eliminarButtons).toHaveLength(3);
  });

  it('shows empty state when no items', () => {
    render(
      <IndicadoresTable
        items={[]}
        isLoading={false}
        isError={false}
        error={null}
      />,
    );

    expect(screen.getByText('No hay indicadores')).toBeInTheDocument();

    // No data rows should be present (only header + empty row)
    const rows = screen.getAllByRole('row');
    expect(rows).toHaveLength(2);
  });

  it('shows loading state when isLoading is true', () => {
    render(
      <IndicadoresTable
        items={[]}
        isLoading={true}
        isError={false}
        error={null}
      />,
    );

    // "Cargando…" appears twice: visible <p> and sr-only <span>
    expect(screen.getAllByText('Cargando…')).toHaveLength(2);
    expect(screen.getByRole('status')).toBeInTheDocument();

    // Table should NOT be rendered when loading
    expect(
      screen.queryByRole('table', { name: 'Listado de indicadores' }),
    ).not.toBeInTheDocument();
  });

  it('shows error state when isError is true', () => {
    const onRetry = vi.fn();

    render(
      <IndicadoresTable
        items={[]}
        isLoading={false}
        isError={true}
        error={new Error('Error de conexión')}
        onRetry={onRetry}
      />,
    );

    expect(screen.getByText('Error de conexión')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();

    const retryButton = screen.getByRole('button', { name: /reintentar/i });
    expect(retryButton).toBeInTheDocument();

    retryButton.click();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('shows default error message when error is null', () => {
    render(
      <IndicadoresTable
        items={[]}
        isLoading={false}
        isError={true}
        error={null}
      />,
    );

    expect(
      screen.getByText('Error desconocido al cargar los indicadores.'),
    ).toBeInTheDocument();
  });

  it('calls onView with indicator id when Ver is clicked', () => {
    const onView = vi.fn();

    render(
      <QueryWrapper>
        <IndicadoresTable
          items={mockIndicadores}
          isLoading={false}
          isError={false}
          error={null}
          onView={onView}
        />
      </QueryWrapper>,
    );

    const verButtons = screen.getAllByText('Ver');
    verButtons[0].click();

    expect(onView).toHaveBeenCalledWith(mockIndicadores[0].id);
  });

  it('calls onEdit with indicator id when Editar is clicked', () => {
    const onEdit = vi.fn();

    render(
      <QueryWrapper>
        <IndicadoresTable
          items={mockIndicadores}
          isLoading={false}
          isError={false}
          error={null}
          onEdit={onEdit}
        />
      </QueryWrapper>,
    );

    const editarButtons = screen.getAllByText('Editar');
    editarButtons[1].click();

    expect(onEdit).toHaveBeenCalledWith(mockIndicadores[1].id);
  });
});
