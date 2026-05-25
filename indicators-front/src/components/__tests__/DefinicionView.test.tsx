/// <reference types="vitest/globals" />
/**
 * Tests for DefinicionView — age range rendering and UUID name resolution.
 *
 * Verifies:
 * - Inclusive min bounds are NOT labeled as exclusive.
 * - Exclusive max bounds ARE labeled as exclusive.
 * - Days bounds (always inclusive) never show "(excl.)".
 * - Location UUIDs resolve to display names from the resolution hook.
 * - Diagnosis concept UUIDs resolve to "codigo → nombre" display.
 * - Unresolved UUIDs fall back to truncated hex display.
 */
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import DefinicionView from '@/components/DefinicionView';
import type { DefinicionIndicadorForm } from '@/api/types';

// ── Mock the resolve hooks so tests don't hit the API ────────────────

const mockLocationDisplayMap = new Map<string, string>();
const mockDiagResolveMap = new Map<string, { codigo?: string; nombre: string }>();

vi.mock('@/features/indicadores/hooks', async () => {
  const actual = await vi.importActual('@/features/indicadores/hooks');
  return {
    ...(actual as object),
    useResolvedLocations: () => ({
      displayMap: mockLocationDisplayMap,
      isLoading: false,
      isError: false,
      error: null,
    }),
    useResolvedDiagnosticos: () => ({
      resolveMap: mockDiagResolveMap,
      isLoading: false,
      isError: false,
      error: null,
    }),
  };
});

// ── Test helpers ─────────────────────────────────────────────────────

function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function renderDef(ui: React.ReactElement) {
  const queryClient = createTestQueryClient();
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );
}

function makeDef(
  overrides: Partial<DefinicionIndicadorForm['poblacion']> = {},
): DefinicionIndicadorForm {
  return {
    tipo: 'conteo_atenciones',
    periodo: 'mes_actual',
    evento: null,
    poblacion: Object.keys(overrides).length > 0
      ? (overrides as DefinicionIndicadorForm['poblacion'])
      : undefined,
  };
}

// ── Reset mocks between tests ────────────────────────────────────────

beforeEach(() => {
  mockLocationDisplayMap.clear();
  mockDiagResolveMap.clear();
});

// ══════════════════════════════════════════════════════════════════════
// Age Range Tests (existing behavior)
// ══════════════════════════════════════════════════════════════════════

describe('DefinicionView age labels', () => {
  it('renders min-only years without (excl.) suffix', () => {
    const def = makeDef({ min_anios: 18 });
    renderDef(<DefinicionView definicion={def} />);
    expect(screen.getByText('desde 18 años')).toBeInTheDocument();
    expect(screen.queryByText(/años \(excl\.\)/)).not.toBeInTheDocument();
  });

  it('renders max-only years with (excl.) suffix', () => {
    const def = makeDef({ max_anios_excl: 5 });
    renderDef(<DefinicionView definicion={def} />);
    expect(screen.getByText('hasta 5 años (excl.)')).toBeInTheDocument();
  });

  it('renders both-years with (excl.) only on max side', () => {
    const def = makeDef({ min_anios: 18, max_anios_excl: 65 });
    renderDef(<DefinicionView definicion={def} />);
    expect(
      screen.getByText('entre 18 años y 65 años (excl.)'),
    ).toBeInTheDocument();
  });

  it('renders min-only months without (excl.) suffix', () => {
    const def = makeDef({ min_meses: 6 });
    renderDef(<DefinicionView definicion={def} />);
    expect(screen.getByText('desde 6 meses')).toBeInTheDocument();
    expect(screen.queryByText(/meses \(excl\.\)/)).not.toBeInTheDocument();
  });

  it('renders max-only months with (excl.) suffix', () => {
    const def = makeDef({ max_meses_excl: 6 });
    renderDef(<DefinicionView definicion={def} />);
    expect(screen.getByText('hasta 6 meses (excl.)')).toBeInTheDocument();
  });

  it('renders days without (excl.) suffix on either side', () => {
    const def = makeDef({ min_dias: 30, max_dias: 365 });
    renderDef(<DefinicionView definicion={def} />);
    expect(screen.getByText('entre 30 días y 365 días')).toBeInTheDocument();
    expect(screen.queryByText(/días \(excl\.\)/)).not.toBeInTheDocument();
  });

  it('renders min-only days without (excl.) suffix', () => {
    const def = makeDef({ min_dias: 1 });
    renderDef(<DefinicionView definicion={def} />);
    expect(screen.getByText('desde 1 días')).toBeInTheDocument();
  });
});

// ══════════════════════════════════════════════════════════════════════
// UUID Resolution Tests
// ══════════════════════════════════════════════════════════════════════

const LOC_UUID_A = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const LOC_UUID_B = '11111111-2222-3333-4444-555555555555';
const DIAG_UUID_X = 'ffffffff-aaaa-bbbb-cccc-dddddddddddd';
const DIAG_UUID_Y = '00000000-1111-2222-3333-444444444444';

function defWithLocation(...uuids: string[]): DefinicionIndicadorForm {
  return {
    tipo: 'conteo_atenciones',
    periodo: 'mes_actual',
    evento: {
      location_uuids: uuids.length > 0 ? uuids : [],
    },
  };
}

function defWithDiagnosticos(
  diags: { concepto_uuids: string[]; tipo_diagnostico?: 'definitivo' | 'presuntivo' }[],
): DefinicionIndicadorForm {
  return {
    tipo: 'conteo_atenciones',
    periodo: 'mes_actual',
    evento: {
      location_uuids: [],
      diagnosticos: diags.map((d) => ({
        concepto_uuids: d.concepto_uuids,
        tipo_diagnostico: d.tipo_diagnostico,
      })),
    },
  };
}

describe('DefinicionView location UUID resolution', () => {
  it('shows resolved display name for a known location UUID', () => {
    mockLocationDisplayMap.set(LOC_UUID_A, 'Consulta Externa');
    const def = defWithLocation(LOC_UUID_A);
    renderDef(<DefinicionView definicion={def} />);
    expect(screen.getByText('Consulta Externa')).toBeInTheDocument();
    // Should NOT show the raw UUID
    expect(screen.queryByText('aaaaaaaa…')).not.toBeInTheDocument();
  });

  it('falls back to truncated UUID for unresolved locations', () => {
    const def = defWithLocation(LOC_UUID_B);
    renderDef(<DefinicionView definicion={def} />);
    // mock map is empty — fallback to truncated UUID
    expect(screen.getByText('11111111…')).toBeInTheDocument();
  });

  it('renders multiple locations with mixed resolution', () => {
    mockLocationDisplayMap.set(LOC_UUID_A, 'Sala de Espera');
    // LOC_UUID_B is NOT in the map → will fall back to truncated UUID
    const def = defWithLocation(LOC_UUID_A, LOC_UUID_B);
    renderDef(<DefinicionView definicion={def} />);
    expect(screen.getByText('Sala de Espera')).toBeInTheDocument();
    expect(screen.getByText('11111111…')).toBeInTheDocument();
  });

  it('shows "Todos los servicios" when location_uuids is empty', () => {
    const def = defWithLocation();
    renderDef(<DefinicionView definicion={def} />);
    expect(screen.getByText('Todos los servicios')).toBeInTheDocument();
  });
});

describe('DefinicionView diagnosis UUID resolution', () => {
  it('shows resolved "codigo → nombre" for known diagnosis concept', () => {
    mockDiagResolveMap.set(DIAG_UUID_X, { codigo: 'A150', nombre: 'Tuberculosis pulmonar' });
    const def = defWithDiagnosticos([
      { concepto_uuids: [DIAG_UUID_X] },
    ]);
    renderDef(<DefinicionView definicion={def} />);
    expect(screen.getByText('A150 → Tuberculosis pulmonar')).toBeInTheDocument();
  });

  it('shows nombre only when codigo is absent', () => {
    mockDiagResolveMap.set(DIAG_UUID_Y, { nombre: 'Diabetes mellitus' });
    const def = defWithDiagnosticos([
      { concepto_uuids: [DIAG_UUID_Y] },
    ]);
    renderDef(<DefinicionView definicion={def} />);
    expect(screen.getByText('Diabetes mellitus')).toBeInTheDocument();
  });

  it('falls back to truncated UUID for unresolved diagnosis', () => {
    const def = defWithDiagnosticos([
      { concepto_uuids: [DIAG_UUID_X] },
    ]);
    renderDef(<DefinicionView definicion={def} />);
    // mock map is empty — fallback to truncated UUID
    expect(screen.getByText('ffffffff…')).toBeInTheDocument();
  });

  it('renders multiple concept UUIDs comma-separated', () => {
    mockDiagResolveMap.set(DIAG_UUID_X, { codigo: 'A150', nombre: 'TBC' });
    mockDiagResolveMap.set(DIAG_UUID_Y, { nombre: 'Diabetes' });
    const def = defWithDiagnosticos([
      { concepto_uuids: [DIAG_UUID_X, DIAG_UUID_Y] },
    ]);
    renderDef(<DefinicionView definicion={def} />);
    expect(screen.getByText('A150 → TBC, Diabetes')).toBeInTheDocument();
  });

  it('renders tipo_diagnostico label alongside concepts', () => {
    mockDiagResolveMap.set(DIAG_UUID_X, { codigo: 'A150', nombre: 'TBC' });
    const def = defWithDiagnosticos([
      { concepto_uuids: [DIAG_UUID_X], tipo_diagnostico: 'definitivo' },
    ]);
    renderDef(<DefinicionView definicion={def} />);
    expect(screen.getByText('A150 → TBC')).toBeInTheDocument();
    expect(screen.getByText('(Definitivo)')).toBeInTheDocument();
  });

  it('shows "Sin concepto" when concepto_uuids is empty', () => {
    const def = defWithDiagnosticos([
      { concepto_uuids: [] },
    ]);
    renderDef(<DefinicionView definicion={def} />);
    expect(screen.getByText('Sin concepto')).toBeInTheDocument();
  });
});
