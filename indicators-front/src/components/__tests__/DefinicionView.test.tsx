/// <reference types="vitest/globals" />
/**
 * Tests for DefinicionView — age range rendering correctness.
 *
 * Verifies that inclusive min bounds are NOT labeled as exclusive,
 * exclusive max bounds ARE labeled as exclusive, and days bounds
 * (always inclusive) never show "(excl.)".
 */
import { render, screen } from '@testing-library/react';
import DefinicionView from '@/components/DefinicionView';
import type { DefinicionIndicadorForm } from '@/api/types';

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

describe('DefinicionView age labels', () => {
  it('renders min-only years without (excl.) suffix', () => {
    const def = makeDef({ min_anios: 18 });
    render(<DefinicionView definicion={def} />);
    // Must NOT contain "(excl.)" on the min side
    expect(screen.getByText('desde 18 años')).toBeInTheDocument();
    expect(screen.queryByText(/años \(excl\.\)/)).not.toBeInTheDocument();
  });

  it('renders max-only years with (excl.) suffix', () => {
    const def = makeDef({ max_anios_excl: 5 });
    render(<DefinicionView definicion={def} />);
    expect(screen.getByText('hasta 5 años (excl.)')).toBeInTheDocument();
  });

  it('renders both-years with (excl.) only on max side', () => {
    const def = makeDef({ min_anios: 18, max_anios_excl: 65 });
    render(<DefinicionView definicion={def} />);
    // "excl." only on the max value
    expect(
      screen.getByText('entre 18 años y 65 años (excl.)'),
    ).toBeInTheDocument();
  });

  it('renders min-only months without (excl.) suffix', () => {
    const def = makeDef({ min_meses: 6 });
    render(<DefinicionView definicion={def} />);
    expect(screen.getByText('desde 6 meses')).toBeInTheDocument();
    expect(screen.queryByText(/meses \(excl\.\)/)).not.toBeInTheDocument();
  });

  it('renders max-only months with (excl.) suffix', () => {
    const def = makeDef({ max_meses_excl: 6 });
    render(<DefinicionView definicion={def} />);
    expect(screen.getByText('hasta 6 meses (excl.)')).toBeInTheDocument();
  });

  it('renders days without (excl.) suffix on either side', () => {
    const def = makeDef({ min_dias: 30, max_dias: 365 });
    render(<DefinicionView definicion={def} />);
    // Days are always inclusive — no excl. anywhere
    expect(screen.getByText('entre 30 días y 365 días')).toBeInTheDocument();
    expect(screen.queryByText(/días \(excl\.\)/)).not.toBeInTheDocument();
  });

  it('renders min-only days without (excl.) suffix', () => {
    const def = makeDef({ min_dias: 1 });
    render(<DefinicionView definicion={def} />);
    expect(screen.getByText('desde 1 días')).toBeInTheDocument();
  });
});
