/// <reference types="vitest/globals" />
/**
 * Integration tests for the IndicadorDetailPage component.
 *
 * Verifies metadata rendering, current definition display, version history
 * with expandable rows, form toggle with IndicadorForm, submission,
 * loading states, and error handling.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import IndicadorDetailPage from '@/pages/IndicadorDetailPage';

function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function renderWithProviders(ui: React.ReactElement, { route = '/indicadores/a1b2c3d4-e5f6-7890-abcd-ef1234567890' } = {}) {
  const queryClient = createTestQueryClient();
  return render(
    <MemoryRouter initialEntries={[route]}>
      <QueryClientProvider client={queryClient}>
        <Routes>
          <Route path="/indicadores/:id" element={ui} />
          <Route path="/" element={<div>Lista de indicadores</div>} />
        </Routes>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('IndicadorDetailPage', () => {
  it('renders metadata card', async () => {
    renderWithProviders(<IndicadorDetailPage />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Tasa de Mortalidad' })).toBeInTheDocument();
    });

    expect(screen.getByText('Mortalidad general por cada 1000 habitantes')).toBeInTheDocument();
    expect(screen.getByText('Activo')).toBeInTheDocument();
    expect(screen.getByText(/Creado el/)).toBeInTheDocument();
  });

  it('renders current definition and compact version history', async () => {
    renderWithProviders(<IndicadorDetailPage />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Historial de versiones' })).toBeInTheDocument();
    });

    // Current definition (latest version = v3)
    expect(screen.getByRole('heading', { name: /Definición actual/ })).toBeInTheDocument();
    expect(screen.getByText(/Conteo de atenciones/)).toBeInTheDocument();
    expect(screen.getByText(/Semana actual/)).toBeInTheDocument();

    // Version history table — compact, only version numbers and dates visible
    expect(screen.getByText('#1')).toBeInTheDocument();
    expect(screen.getByText('#2')).toBeInTheDocument();
    expect(screen.getByText('#3')).toBeInTheDocument();

    // Definitions are collapsed by default — expand version 1
    const expandButtons = screen.getAllByRole('button', { name: 'Ver definición' });
    expect(expandButtons).toHaveLength(3);

    await userEvent.click(expandButtons[0]);
    await waitFor(() => {
      expect(screen.getByText(/Mes actual/)).toBeInTheDocument();
      expect(screen.getByText(/Definitivo/)).toBeInTheDocument();
    });

    // Expand version 2
    await userEvent.click(expandButtons[1]);
    await waitFor(() => {
      expect(screen.getByText(/Conteo de pacientes/)).toBeInTheDocument();
      expect(screen.getByText(/Mes anterior/)).toBeInTheDocument();
      expect(screen.getByText(/Masculino/)).toBeInTheDocument();
      expect(screen.getByText('entre 18 años y 65 años')).toBeInTheDocument();
    });
  });

  it('shows loading state initially', () => {
    renderWithProviders(<IndicadorDetailPage />);

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getAllByText('Cargando indicador…')).toHaveLength(2);
  });

  it('shows 404 error with back link', async () => {
    renderWithProviders(<IndicadorDetailPage />, {
      route: '/indicadores/00000000-0000-0000-0000-000000000000',
    });

    await waitFor(() => {
      expect(screen.getByText('Indicador no encontrado')).toBeInTheDocument();
    });

    expect(screen.getByRole('link', { name: /volver al listado/i })).toBeInTheDocument();
  });

  it('toggles the IndicadorForm for new version', async () => {
    renderWithProviders(<IndicadorDetailPage />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Tasa de Mortalidad' })).toBeInTheDocument();
    });

    const toggleButton = screen.getByRole('button', { name: 'Nueva versión' });
    expect(toggleButton).toBeInTheDocument();

    await userEvent.click(toggleButton);

    // The form should now be visible — IndicadorForm renders a "Tipo de indicador" select
    expect(screen.getByRole('heading', { name: 'Crear nueva versión' })).toBeInTheDocument();
    expect(screen.getByLabelText('Tipo de indicador')).toBeInTheDocument();

    // Pre-populated with latest version values (version 3 = conteo_atenciones)
    expect(screen.getByLabelText('Tipo de indicador')).toHaveValue('conteo_atenciones');

    // Cancel button collapses the form
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar nueva versión' }));

    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: 'Crear nueva versión' })).not.toBeInTheDocument();
    });
  });

  it('pre-populates form with latest version data', async () => {
    renderWithProviders(<IndicadorDetailPage />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Tasa de Mortalidad' })).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole('button', { name: 'Nueva versión' }));

    // Latest version (v3) has tipo=conteo_atenciones, periodo=semana_actual
    expect(screen.getByLabelText('Tipo de indicador')).toHaveValue('conteo_atenciones');
    expect(screen.getByLabelText('Período')).toHaveValue('semana_actual');
  });
});
