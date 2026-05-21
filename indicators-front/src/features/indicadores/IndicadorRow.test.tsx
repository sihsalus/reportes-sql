/// <reference types="vitest/globals" />
/**
 * Tests for the IndicadorRow component.
 *
 * Verifies navigation via the "Ver" button using react-router's useNavigate.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import IndicadorRow from '@/features/indicadores/IndicadorRow';
import type { Indicador } from '@/api/types';

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

const mockNavigate = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

const mockIndicador: Indicador = {
  id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  nombre: 'Tasa de Mortalidad',
  descripcion: 'Mortalidad general',
  activo: true,
  creado_en: '2026-01-15T10:30:00Z',
};

describe('IndicadorRow', () => {
  afterEach(() => {
    mockNavigate.mockClear();
  });

  it('navigates to /indicadores/:id when Ver is clicked without onView prop', () => {
    render(
      <QueryWrapper>
        <table>
          <tbody>
            <IndicadorRow indicador={mockIndicador} />
          </tbody>
        </table>
      </QueryWrapper>,
    );

    const verButton = screen.getByRole('button', { name: /ver indicador/i });
    verButton.click();

    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith('/indicadores/a1b2c3d4-e5f6-7890-abcd-ef1234567890');
  });

  it('calls onView prop instead of navigate when provided', () => {
    const onView = vi.fn();

    render(
      <QueryWrapper>
        <table>
          <tbody>
            <IndicadorRow indicador={mockIndicador} onView={onView} />
          </tbody>
        </table>
      </QueryWrapper>,
    );

    const verButton = screen.getByRole('button', { name: /ver indicador/i });
    verButton.click();

    expect(mockNavigate).not.toHaveBeenCalled();
    expect(onView).toHaveBeenCalledWith(mockIndicador.id);
  });

  it('shows inline error in dialog and keeps dialog open when delete returns 502', async () => {
    const delete502Indicador: Indicador = {
      id: '50250250-2502-4502-8502-502502502502',
      nombre: 'Indicador con Error',
      descripcion: null,
      activo: true,
      creado_en: '2026-01-15T10:30:00Z',
    };

    const user = userEvent.setup();

    render(
      <QueryWrapper>
        <table>
          <tbody>
            <IndicadorRow indicador={delete502Indicador} />
          </tbody>
        </table>
      </QueryWrapper>,
    );

    // Open the confirmation dialog
    const deleteButton = screen.getByRole('button', {
      name: /eliminar indicador indicador con error/i,
    });
    await user.click(deleteButton);

    // Verify dialog is open
    expect(screen.getByText(/eliminar indicador/i)).toBeInTheDocument();

    // Click confirm to trigger the delete mutation
    const confirmButton = screen.getByRole('button', { name: /^eliminar$/i });
    await user.click(confirmButton);

    // Wait for the error to appear in the dialog
    await waitFor(() => {
      expect(screen.getByText(/upstream service unavailable/i)).toBeInTheDocument();
    });

    // Dialog should still be open (not dismissed by success)
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
