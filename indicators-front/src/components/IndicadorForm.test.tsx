/// <reference types="vitest/globals" />
/**
 * Tests for the IndicadorForm component.
 *
 * Verifies validation (Zod errors), diagnosticos/ordenes toggle,
 * edit pre-population, and server error display.
 * Uses the new nested evento shape (diagnosticos/ordenes inside evento).
 */

import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { IndicadorFormValues } from '@/features/indicadores/schema';

vi.mock('@/components/EncounterTypeSelector', () => ({
  default: function MockEncounterTypeSelector({ control, name }: { control: unknown; name: string }) {
    const { useController } = require('react-hook-form');
    const { field } = useController({ control, name });
    return (
      <input
        type="hidden"
        {...field}
        value={JSON.stringify(field.value ?? [])}
        data-testid="encounter-types"
      />
    );
  },
}));

import IndicadorForm from '@/components/IndicadorForm';

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

const validEncounterUUID = '550e8400-e29b-41d4-a716-446655440000';

describe('IndicadorForm', () => {
  it('pre-populates fields in edit mode and hides definition fields', () => {
    const defaultValues: IndicadorFormValues = {
      nombre: 'Indicador de prueba',
      descripcion: 'Descripción de prueba',
      tipo: 'conteo_pacientes',
      periodo: 'mes_anterior',
      evento: {
        encounter_type_uuids: [validEncounterUUID],
        minimo_ocurrencias: 2,
        diagnosticos: [
          { concepto_uuids: ['diag-uuid-1'], tipo_diagnostico: 'definitivo' },
        ],
      },
      poblacion: {
        edad_min_anios: 18,
        edad_max_anios: 65,
        sexo: 'M',
      },
    };

    renderWithProviders(
      <IndicadorForm mode="edit" defaultValues={defaultValues} onSubmit={vi.fn()} />,
    );

    expect(screen.getByDisplayValue('Indicador de prueba')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Descripción de prueba')).toBeInTheDocument();

    // Definition fields should NOT be visible in edit mode
    expect(screen.queryByLabelText('Tipo de indicador')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Período')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Edad mínima (años)')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Mínimo de ocurrencias')).not.toBeInTheDocument();
  });

  it('blocks submit when nombre is empty', async () => {
    const onSubmit = vi.fn();
    renderWithProviders(<IndicadorForm mode="create" onSubmit={onSubmit} />);

    const submitButton = screen.getByRole('button', { name: /Crear indicador/ });
    await userEvent.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText('El nombre es obligatorio')).toBeInTheDocument();
    });

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('calls onSubmit with valid data on create (no filtro)', async () => {
    const onSubmit = vi.fn();
    const defaultValues: IndicadorFormValues = {
      nombre: 'Nuevo Indicador',
      descripcion: null,
      tipo: 'conteo_atenciones',
      periodo: 'mes_actual',
      evento: {
        encounter_type_uuids: [validEncounterUUID],
        minimo_ocurrencias: 1,
      },
      poblacion: undefined,
    };
    renderWithProviders(
      <IndicadorForm mode="create" onSubmit={onSubmit} defaultValues={defaultValues} />,
    );

    await waitFor(() => {
      expect(screen.queryByText('Cargando tipos de encuentro…')).not.toBeInTheDocument();
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });

    const form = document.querySelector('form');
    expect(form).not.toBeNull();
    fireEvent.submit(form!);

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });

    const payload = onSubmit.mock.calls[0][0] as IndicadorFormValues;
    expect(payload.nombre).toBe('Nuevo Indicador');
    expect(payload.evento?.encounter_type_uuids).toContain(validEncounterUUID);
  });

  it('displays server error from prop', () => {
    renderWithProviders(
      <IndicadorForm
        mode="create"
        onSubmit={vi.fn()}
        serverError="Error del servicio externo. Intente nuevamente."
      />,
    );

    expect(
      screen.getByText('Error del servicio externo. Intente nuevamente.'),
    ).toBeInTheDocument();
  });

  it('displays 422-style server error', () => {
    renderWithProviders(
      <IndicadorForm
        mode="create"
        onSubmit={vi.fn()}
        serverError={JSON.stringify({ field: 'nombre', message: 'Ya existe' })}
      />,
    );

    expect(
      screen.getByText(JSON.stringify({ field: 'nombre', message: 'Ya existe' })),
    ).toBeInTheDocument();
  });
});

describe('IndicadorForm Filtro toggle', () => {
  it('renders filtro toggle buttons in create mode', () => {
    renderWithProviders(<IndicadorForm mode="create" onSubmit={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Ninguno' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Diagnósticos' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Órdenes' })).toBeInTheDocument();
  });

  it('shows diagnosticos fields when Diagnósticos toggle is clicked', async () => {
    renderWithProviders(<IndicadorForm mode="create" onSubmit={vi.fn()} />);

    const diagButton = screen.getByRole('button', { name: 'Diagnósticos' });
    await userEvent.click(diagButton);

    // Should show the diagnosticos section with single block, no agregar button
    expect(screen.getByPlaceholderText('Buscar diagnóstico…')).toBeInTheDocument();
    // "Agregar diagnóstico" button must NOT be present (single unified block)
    expect(screen.queryByText('Agregar diagnóstico')).not.toBeInTheDocument();
    // No "Diagnóstico #N" headings in single-block mode
    expect(screen.queryByText(/Diagnóstico #/)).not.toBeInTheDocument();
  });

  it('shows ordenes fields when Órdenes toggle is clicked', async () => {
    renderWithProviders(<IndicadorForm mode="create" onSubmit={vi.fn()} />);

    const ordButton = screen.getByRole('button', { name: 'Órdenes' });
    await userEvent.click(ordButton);

    // Should show the ordenes section
    expect(screen.getByText('Agregar concepto')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('UUID o identificador del concepto')).toBeInTheDocument();
  });

  it('toggle clears the other field — diag to ordenes', async () => {
    renderWithProviders(<IndicadorForm mode="create" onSubmit={vi.fn()} />);

    // First select diagnosticos
    await userEvent.click(screen.getByRole('button', { name: 'Diagnósticos' }));
    expect(screen.getByPlaceholderText('Buscar diagnóstico…')).toBeInTheDocument();

    // Then switch to ordenes
    await userEvent.click(screen.getByRole('button', { name: 'Órdenes' }));
    // The diagnosticos input should be gone
    expect(screen.queryByPlaceholderText('Buscar diagnóstico…')).not.toBeInTheDocument();
    // The ordenes input should be visible
    expect(screen.getByPlaceholderText('UUID o identificador del concepto')).toBeInTheDocument();
  });

  it('adds and removes orden concepto rows', async () => {
    renderWithProviders(<IndicadorForm mode="create" onSubmit={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: 'Órdenes' }));

    // Should already have one row
    const inputs = screen.getAllByPlaceholderText(/UUID o identificador del concepto/);
    expect(inputs).toHaveLength(1);

    // Add another
    await userEvent.click(screen.getByRole('button', { name: 'Agregar concepto' }));
    const inputs2 = screen.getAllByPlaceholderText(/UUID o identificador del concepto/);
    expect(inputs2).toHaveLength(2);

    // Remove it
    const removeButtons = screen.getAllByRole('button', { name: /Quitar concepto/ });
    await userEvent.click(removeButtons[0]);

    await waitFor(() => {
      const remaining = screen.getAllByPlaceholderText(/UUID o identificador del concepto/);
      expect(remaining).toHaveLength(1);
    });
  });

  it('hides filtro section in edit mode', () => {
    renderWithProviders(<IndicadorForm mode="edit" onSubmit={vi.fn()} />);

    expect(screen.queryByText('Ninguno')).not.toBeInTheDocument();
    expect(screen.queryByText('Diagnósticos')).not.toBeInTheDocument();
    expect(screen.queryByText('Órdenes')).not.toBeInTheDocument();
  });

  it('submits payload with nested diagnosticos', async () => {
    const onSubmit = vi.fn();
    const defaultValues: IndicadorFormValues = {
      nombre: 'Test Diag',
      descripcion: null,
      tipo: 'conteo_atenciones',
      periodo: 'mes_actual',
      evento: {
        encounter_type_uuids: [validEncounterUUID],
        minimo_ocurrencias: 1,
        diagnosticos: [
          { concepto_uuids: ['diag-uuid-1'], tipo_diagnostico: 'definitivo' },
        ],
      },
    };
    renderWithProviders(
      <IndicadorForm mode="create" onSubmit={onSubmit} defaultValues={defaultValues} />,
    );

    await act(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });

    const form = document.querySelector('form');
    expect(form).not.toBeNull();
    fireEvent.submit(form!);

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });

    const payload = onSubmit.mock.calls[0][0] as IndicadorFormValues;
    expect(payload.evento?.diagnosticos).toHaveLength(1);
    expect(payload.evento?.diagnosticos?.[0].concepto_uuids).toContain('diag-uuid-1');
    expect(payload.evento?.diagnosticos?.[0].tipo_diagnostico).toBe('definitivo');
  });

  it('submits payload with nested ordenes', async () => {
    const onSubmit = vi.fn();
    const defaultValues: IndicadorFormValues = {
      nombre: 'Test Orden',
      descripcion: null,
      tipo: 'conteo_pacientes',
      periodo: 'mes_actual',
      evento: {
        encounter_type_uuids: [validEncounterUUID],
        minimo_ocurrencias: 1,
        ordenes: [
          { concepto_uuid: 'ord-uuid-1' },
        ],
      },
    };
    renderWithProviders(
      <IndicadorForm mode="create" onSubmit={onSubmit} defaultValues={defaultValues} />,
    );

    await act(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });

    const form = document.querySelector('form');
    expect(form).not.toBeNull();
    fireEvent.submit(form!);

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });

    const payload = onSubmit.mock.calls[0][0] as IndicadorFormValues;
    expect(payload.evento?.ordenes).toHaveLength(1);
    expect(payload.evento?.ordenes?.[0].concepto_uuid).toBe('ord-uuid-1');
  });
});
