/// <reference types="vitest/globals" />
import { render, screen, waitFor, fireEvent, act, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { IndicadorFormValues } from '@/features/indicadores/schema';

vi.mock('@/components/LocationSelector', () => ({
  default: function MockLocationSelector({ control, name }: { control: unknown; name: string }) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { useController } = require('react-hook-form');
    const { field } = useController({ control, name });
    return (
      <input
        type="hidden"
        {...field}
        value={JSON.stringify(field.value ?? [])}
        data-testid="location-uuids"
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

const validLocationUUID = '550e8400-e29b-41d4-a716-446655440000';

describe('IndicadorForm', () => {
  it('pre-populates fields in edit mode and hides definition fields', () => {
    const defaultValues: IndicadorFormValues = {
      nombre: 'Indicador de prueba',
      descripcion: 'Descripción de prueba',
      tipo: 'conteo_pacientes',
      periodo: 'trimestre_actual',
      evento: {
        location_uuids: [validLocationUUID],
        minimo_ocurrencias: 2,
        diagnosticos: [
          { concepto_uuids: ['diag-uuid-1'], tipo_diagnostico: 'definitivo' },
        ],
      },
      poblacion: {
        min_anios: 18,
        max_anios_excl: 65,
        sexo: 'M',
      },
    };

    renderWithProviders(
      <IndicadorForm mode="edit" defaultValues={defaultValues} onSubmit={vi.fn()} />,
    );

    expect(screen.getByDisplayValue('Indicador de prueba')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Descripción de prueba')).toBeInTheDocument();

    expect(screen.queryByLabelText('Tipo de indicador')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Período')).not.toBeInTheDocument();
    expect(screen.queryByText('Filtros de población (opcional)')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Mínimo de atenciones')).not.toBeInTheDocument();
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
        location_uuids: [validLocationUUID],
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
    expect(payload.evento?.location_uuids).toContain(validLocationUUID);
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

    expect(screen.getByPlaceholderText('Buscar diagnóstico…')).toBeInTheDocument();
    expect(screen.queryByText('Agregar diagnóstico')).not.toBeInTheDocument();
    expect(screen.queryByText(/Diagnóstico #/)).not.toBeInTheDocument();
  });

  it('shows ordenes fields when Órdenes toggle is clicked', async () => {
    renderWithProviders(<IndicadorForm mode="create" onSubmit={vi.fn()} />);

    const ordButton = screen.getByRole('button', { name: 'Órdenes' });
    await userEvent.click(ordButton);

    expect(screen.getByPlaceholderText('Buscar orden o prueba…')).toBeInTheDocument();
  });

  it('toggle clears the other field — diag to ordenes', async () => {
    renderWithProviders(<IndicadorForm mode="create" onSubmit={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: 'Diagnósticos' }));
    expect(screen.getByPlaceholderText('Buscar diagnóstico…')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Órdenes' }));
    expect(screen.queryByPlaceholderText('Buscar diagnóstico…')).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText('Buscar orden o prueba…')).toBeInTheDocument();
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
        location_uuids: [validLocationUUID],
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
        location_uuids: [validLocationUUID],
        minimo_ocurrencias: 1,
        ordenes: [
          { concepto_uuids: ['ord-uuid-1'] },
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
    expect(payload.evento?.ordenes?.[0].concepto_uuids).toContain('ord-uuid-1');
  });
});

describe('IndicadorForm age transformation', () => {
  const setAgeInput = async (label: string, value: string) => {
    const input = screen.getByRole('spinbutton', { name: new RegExp(label, 'i') });
    await userEvent.clear(input);
    if (value) {
      await userEvent.type(input, value);
    }
  };

  const ageTestDefaults: IndicadorFormValues = {
    nombre: 'Test Age',
    descripcion: null,
    tipo: 'conteo_atenciones',
    periodo: 'mes_actual',
    evento: { location_uuids: [validLocationUUID], minimo_ocurrencias: 1 },
  };

  const submitAndGetPayload = async (onSubmit: ReturnType<typeof vi.fn>) => {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });
    const form = document.querySelector('form');
    expect(form).not.toBeNull();
    fireEvent.submit(form!);
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });
    return onSubmit.mock.calls[0][0] as IndicadorFormValues;
  };

  const renderAgeForm = (onSubmit: ReturnType<typeof vi.fn>) => {
    return renderWithProviders(
      <IndicadorForm mode="create" onSubmit={onSubmit} defaultValues={ageTestDefaults} />,
    );
  };

  it('pre-populates min anios from min_anios default', () => {
    const defaultValues: IndicadorFormValues = {
      nombre: 'Test',
      descripcion: null,
      tipo: 'conteo_atenciones',
      periodo: 'mes_actual',
      evento: { location_uuids: [validLocationUUID], minimo_ocurrencias: 1 },
      poblacion: { min_anios: 12 },
    };
    renderWithProviders(
      <IndicadorForm mode="create" onSubmit={vi.fn()} defaultValues={defaultValues} />,
    );

    const aniosInput = screen.getByRole('spinbutton', { name: /Edad mínima años/i }) as HTMLInputElement;
    expect(aniosInput.value).toBe('12');
    const mesesInput = screen.getByRole('spinbutton', { name: /Edad mínima meses/i }) as HTMLInputElement;
    expect(mesesInput.value).toBe('');
  });

  it('pre-populates min from min_meses default', () => {
    const defaultValues: IndicadorFormValues = {
      nombre: 'Test',
      descripcion: null,
      tipo: 'conteo_atenciones',
      periodo: 'mes_actual',
      evento: { location_uuids: [validLocationUUID], minimo_ocurrencias: 1 },
      poblacion: { min_meses: 18 },
    };
    renderWithProviders(
      <IndicadorForm mode="create" onSubmit={vi.fn()} defaultValues={defaultValues} />,
    );

    const aniosInput = screen.getByRole('spinbutton', { name: /Edad mínima años/i }) as HTMLInputElement;
    expect(aniosInput.value).toBe('1');
    const mesesInput = screen.getByRole('spinbutton', { name: /Edad mínima meses/i }) as HTMLInputElement;
    expect(mesesInput.value).toBe('6');
  });

  it('pre-populates min from min_dias default', () => {
    const defaultValues: IndicadorFormValues = {
      nombre: 'Test',
      descripcion: null,
      tipo: 'conteo_atenciones',
      periodo: 'mes_actual',
      evento: { location_uuids: [validLocationUUID], minimo_ocurrencias: 1 },
      poblacion: { min_dias: 15 },
    };
    renderWithProviders(
      <IndicadorForm mode="create" onSubmit={vi.fn()} defaultValues={defaultValues} />,
    );

    const diasInput = screen.getByRole('spinbutton', { name: /Edad mínima días/i }) as HTMLInputElement;
    expect(diasInput.value).toBe('15');
    const aniosInput = screen.getByRole('spinbutton', { name: /Edad mínima años/i }) as HTMLInputElement;
    expect(aniosInput.value).toBe('');
  });

  it('pre-populates max from max_meses_excl default', () => {
    const defaultValues: IndicadorFormValues = {
      nombre: 'Test',
      descripcion: null,
      tipo: 'conteo_atenciones',
      periodo: 'mes_actual',
      evento: { location_uuids: [validLocationUUID], minimo_ocurrencias: 1 },
      poblacion: { max_meses_excl: 24 },
    };
    renderWithProviders(
      <IndicadorForm mode="create" onSubmit={vi.fn()} defaultValues={defaultValues} />,
    );

    const aniosInput = screen.getByRole('spinbutton', { name: /Edad máxima años/i }) as HTMLInputElement;
    expect(aniosInput.value).toBe('2');
    const mesesInput = screen.getByRole('spinbutton', { name: /Edad máxima meses/i }) as HTMLInputElement;
    expect(mesesInput.value).toBe('0');
  });

  it('pre-populates max from max_dias default', () => {
    const defaultValues: IndicadorFormValues = {
      nombre: 'Test',
      descripcion: null,
      tipo: 'conteo_atenciones',
      periodo: 'mes_actual',
      evento: { location_uuids: [validLocationUUID], minimo_ocurrencias: 1 },
      poblacion: { max_dias: 28 },
    };
    renderWithProviders(
      <IndicadorForm mode="create" onSubmit={vi.fn()} defaultValues={defaultValues} />,
    );

    const diasInput = screen.getByRole('spinbutton', { name: /Edad máxima días/i }) as HTMLInputElement;
    expect(diasInput.value).toBe('28');
  });

  it('submits no poblacion when all age fields are 0/0/0', async () => {
    const onSubmit = vi.fn();
    renderAgeForm(onSubmit);

    await setAgeInput('Edad mínima años', '0');
    await setAgeInput('Edad mínima meses', '0');
    await setAgeInput('Edad mínima días', '0');

    const payload = await submitAndGetPayload(onSubmit);
    expect(payload.poblacion).toBeUndefined();
  });

  it('transforms min=1a0m0d to min_meses: 12', async () => {
    const onSubmit = vi.fn();
    renderAgeForm(onSubmit);

    await setAgeInput('Edad mínima años', '1');

    const payload = await submitAndGetPayload(onSubmit);
    expect(payload.poblacion).toEqual({ min_meses: 12 });
  });

  it('transforms min=0a6m0d to min_meses: 6', async () => {
    const onSubmit = vi.fn();
    renderAgeForm(onSubmit);

    await setAgeInput('Edad mínima meses', '6');

    const payload = await submitAndGetPayload(onSubmit);
    expect(payload.poblacion).toEqual({ min_meses: 6 });
  });

  it('transforms min=0a0m5d to min_dias: 5', async () => {
    const onSubmit = vi.fn();
    renderAgeForm(onSubmit);

    await setAgeInput('Edad mínima días', '5');

    const payload = await submitAndGetPayload(onSubmit);
    expect(payload.poblacion).toEqual({ min_dias: 5 });
  });

  it('min with años+meses>0 ignores dias', async () => {
    const onSubmit = vi.fn();
    renderAgeForm(onSubmit);

    await setAgeInput('Edad mínima años', '1');
    await setAgeInput('Edad mínima días', '10');

    const payload = await submitAndGetPayload(onSubmit);
    expect(payload.poblacion).toEqual({ min_meses: 12 });
  });

  it('transforms max=1a0m0d to max_meses_excl: 12', async () => {
    const onSubmit = vi.fn();
    renderAgeForm(onSubmit);

    await setAgeInput('Edad máxima años', '1');

    const payload = await submitAndGetPayload(onSubmit);
    expect(payload.poblacion).toEqual({ max_meses_excl: 12 });
  });

  it('transforms max=0a0m5d to max_dias: 5', async () => {
    const onSubmit = vi.fn();
    renderAgeForm(onSubmit);

    await setAgeInput('Edad máxima días', '5');

    const payload = await submitAndGetPayload(onSubmit);
    expect(payload.poblacion).toEqual({ max_dias: 5 });
  });

  it('max with años+meses>0 and dias>0 adds +1 to meses', async () => {
    const onSubmit = vi.fn();
    renderAgeForm(onSubmit);

    await setAgeInput('Edad máxima años', '1');
    await setAgeInput('Edad máxima días', '5');

    const payload = await submitAndGetPayload(onSubmit);
    expect(payload.poblacion).toEqual({ max_meses_excl: 13 });
  });

  it('preserves sexo alongside age fields', async () => {
    const onSubmit = vi.fn();
    renderAgeForm(onSubmit);

    await setAgeInput('Edad mínima años', '2');
    const sexoSelect = screen.getByLabelText('Sexo');
    await userEvent.selectOptions(sexoSelect, 'M');

    const payload = await submitAndGetPayload(onSubmit);
    expect(payload.poblacion).toEqual({ min_meses: 24, sexo: 'M' });
  });

  it('renders labels: Atención, Servicio, Filtro clínico', () => {
    renderWithProviders(<IndicadorForm mode="create" onSubmit={vi.fn()} />);

    expect(screen.getByRole('heading', { name: 'Atención' })).toBeInTheDocument();
    expect(screen.getByText('Servicio')).toBeInTheDocument();
    expect(screen.getByText('Filtro clínico')).toBeInTheDocument();
  });

  it('hides Mínimo de atenciones when Filtro clínico = Ninguno', () => {
    renderWithProviders(<IndicadorForm mode="create" onSubmit={vi.fn()} />);

    expect(screen.queryByLabelText('Mínimo de atenciones')).not.toBeInTheDocument();
  });

  it('shows Mínimo de atenciones inside Diagnósticos section', async () => {
    renderWithProviders(<IndicadorForm mode="create" onSubmit={vi.fn()} />);

    const diagButton = screen.getByRole('button', { name: 'Diagnósticos' });
    await userEvent.click(diagButton);

    expect(screen.getByLabelText('Mínimo de atenciones')).toBeInTheDocument();
    const atencionSection = screen.getByRole('heading', { name: 'Atención' }).closest('section');
    expect(atencionSection).not.toBeNull();
    expect(atencionSection!.querySelector('#evento\\.minimo_ocurrencias')).not.toBeNull();
  });

  it('shows Mínimo de atenciones inside Órdenes section', async () => {
    renderWithProviders(<IndicadorForm mode="create" onSubmit={vi.fn()} />);

    const ordButton = screen.getByRole('button', { name: 'Órdenes' });
    await userEvent.click(ordButton);

    expect(screen.getByLabelText('Mínimo de atenciones')).toBeInTheDocument();
    const atencionSection = screen.getByRole('heading', { name: 'Atención' }).closest('section');
    expect(atencionSection).not.toBeNull();
    expect(atencionSection!.querySelector('#evento\\.minimo_ocurrencias')).not.toBeNull();
  });
});
