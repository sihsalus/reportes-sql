/// <reference types="vitest/globals" />
/**
 * Tests for parseDefinicion — old-format JSONB normalization.
 *
 * Covers the spec scenario: "Old JSONB with encounter_type_uuids loads
 * into Servicio" (parseDefinicion helper).
 */
import { parseDefinicion } from './parseDefinicion';
import type { DefinicionIndicadorForm } from '@/api/types';

describe('parseDefinicion', () => {
  it('returns defaults when definicion is null or undefined', () => {
    const result = parseDefinicion(null);
    expect(result.tipo).toBe('conteo_atenciones');
    expect(result.periodo).toBe('mes_actual');
    expect(result.evento).not.toBeNull();
    expect(result.evento!.location_uuids).toEqual([]);
  });

  it('normalizes legacy evento.encounter_type_uuids into location_uuids', () => {
    const legacyDef = {
      tipo: 'conteo_atenciones',
      periodo: 'mes_actual',
      evento: {
        encounter_type_uuids: ['uuid-a', 'uuid-b'],
        minimo_ocurrencias: 1,
      },
    };

    const result = parseDefinicion(legacyDef);

    expect(result.evento).not.toBeNull();
    expect(result.evento!.location_uuids).toEqual(['uuid-a', 'uuid-b']);
    expect((result.evento as Record<string, unknown>).encounter_type_uuids).toBeUndefined();
  });

  it('keeps direct location_uuids when already present in evento', () => {
    const modernDef = {
      tipo: 'conteo_pacientes',
      periodo: 'trimestre_actual',
      evento: {
        location_uuids: ['uuid-x', 'uuid-y'],
        minimo_ocurrencias: 3,
      },
    };

    const result = parseDefinicion(modernDef);

    expect(result.evento!.location_uuids).toEqual(['uuid-x', 'uuid-y']);
  });

  it('prefers location_uuids over encounter_type_uuids when both exist', () => {
    const hybridDef = {
      tipo: 'conteo_atenciones',
      periodo: 'semestre_actual',
      evento: {
        location_uuids: ['uuid-new'],
        encounter_type_uuids: ['uuid-old'],
      },
    };

    const result = parseDefinicion(hybridDef);

    // location_uuids takes precedence (line 95 check is first)
    expect(result.evento!.location_uuids).toEqual(['uuid-new']);
  });

  it('normalizes old flat eventos array (first element)', () => {
    const oldFlat = {
      tipo: 'conteo_atenciones',
      periodo: 'mes_actual',
      eventos: [
        {
          encounter_type_uuids: ['uuid-legacy-1'],
          minimo_ocurrencias: 2,
        },
      ],
    };

    const result = parseDefinicion(oldFlat);

    expect(result.evento).not.toBeNull();
    expect(result.evento!.location_uuids).toEqual(['uuid-legacy-1']);
  });

  it('handles empty evento gracefully', () => {
    const result = parseDefinicion({ tipo: 'conteo_atenciones', periodo: 'mes_actual' });
    expect(result.evento!.location_uuids).toEqual([]);
  });

  it('returns fully typed DefinicionIndicadorForm shape', () => {
    const def = {
      tipo: 'conteo_pacientes',
      periodo: 'anual_actual',
      evento: {
        location_uuids: ['550e8400-e29b-41d4-a716-446655440000'],
      },
    };

    const result: DefinicionIndicadorForm = parseDefinicion(def);
    expect(result.tipo).toBe('conteo_pacientes');
    expect(result.periodo).toBe('anual_actual');
    expect(result.evento!.location_uuids).toHaveLength(1);
  });
});
