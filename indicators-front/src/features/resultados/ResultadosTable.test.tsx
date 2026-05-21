/// <reference types="vitest/globals" />
/**
 * Tests for the ResultadosTable component.
 *
 * Verifies rendering of rows, empty state, loading state, and error state.
 */

import { render, screen } from '@testing-library/react';
import ResultadosTable from '@/features/resultados/ResultadosTable';
import type { IndicadorResultado } from '@/api/types';

/** Reusable fixture data. */
const mockResultados: IndicadorResultado[] = [
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
];

describe('ResultadosTable', () => {
  it('renders a table with resultados rows', () => {
    render(
      <ResultadosTable
        items={mockResultados}
        isLoading={false}
        isError={false}
        error={null}
      />,
    );

    const table = screen.getByRole('table', {
      name: 'Listado de resultados',
    });
    expect(table).toBeInTheDocument();

    expect(
      screen.getByRole('columnheader', { name: 'Indicador' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('columnheader', { name: 'Versión' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('columnheader', { name: 'Periodo Inicio' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('columnheader', { name: 'Periodo Fin' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('columnheader', { name: 'Valor' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('columnheader', { name: 'Calculado en' }),
    ).toBeInTheDocument();

    const rows = screen.getAllByRole('row');
    // 1 header row + 2 data rows = 3 rows
    expect(rows).toHaveLength(3);

    expect(screen.getByText('Tasa de Mortalidad')).toBeInTheDocument();
    expect(screen.getByText('Cobertura de Vacunación')).toBeInTheDocument();

    // Check values are rendered
    expect(screen.getByText('4,2')).toBeInTheDocument();
    expect(screen.getByText('87,5')).toBeInTheDocument();
  });

  it('shows empty state when no items', () => {
    render(
      <ResultadosTable
        items={[]}
        isLoading={false}
        isError={false}
        error={null}
      />,
    );

    expect(screen.getByText('No hay resultados')).toBeInTheDocument();

    const rows = screen.getAllByRole('row');
    expect(rows).toHaveLength(2);
  });

  it('shows loading state when isLoading is true', () => {
    render(
      <ResultadosTable
        items={[]}
        isLoading={true}
        isError={false}
        error={null}
      />,
    );

    expect(screen.getAllByText('Cargando…')).toHaveLength(2);
    expect(screen.getByRole('status')).toBeInTheDocument();

    expect(
      screen.queryByRole('table', { name: 'Listado de resultados' }),
    ).not.toBeInTheDocument();
  });

  it('shows error state when isError is true', () => {
    const onRetry = vi.fn();

    render(
      <ResultadosTable
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
      <ResultadosTable
        items={[]}
        isLoading={false}
        isError={true}
        error={null}
      />,
    );

    expect(
      screen.getByText('Error desconocido al cargar los resultados.'),
    ).toBeInTheDocument();
  });

  it('renders em-dash for null indicator name or version', () => {
    const resultadosWithNulls: IndicadorResultado[] = [
      {
        id: 'r3a1b2c3-d4e5-f678-90ab-cdef12345680',
        indicador_version_id: 'v3a1b2c3-d4e5-f678-90ab-cdef12345680',
        indicador_nombre: null,
        indicador_version_num: null,
        periodo_inicio: '2026-03-01',
        periodo_fin: '2026-03-31',
        valor: 10,
        calculado_en: '2026-04-01T10:00:00Z',
      },
    ];

    render(
      <ResultadosTable
        items={resultadosWithNulls}
        isLoading={false}
        isError={false}
        error={null}
      />,
    );

    const emDashes = screen.getAllByText('—');
    expect(emDashes.length).toBeGreaterThanOrEqual(2);
  });
});
