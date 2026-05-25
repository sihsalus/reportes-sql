/**
 * MSW request handlers for API mocking in tests.
 *
 * Each handler simulates the backend REST API so tests can verify
 * loading, success, and error states without a running server.
 */

import { http, HttpResponse } from 'msw';
import type { Indicador, IndicadorDetail, IndicadorVersion, PaginatedResponse, IndicadorResultado, BatchCalcularNowResponse, DiagnosticoOption, LocationOption, OrdenOption, IndicadorSQLPreview } from '@/api/types';

/** In-memory fixture store — shared across handlers. */
const fixtureIndicadores: Indicador[] = [
  {
    id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    nombre: 'Tasa de Mortalidad',
    descripcion: 'Mortalidad general por cada 1000 habitantes',
    activo: true,
    creado_en: '2026-01-15T10:30:00Z',
  },
  {
    id: 'b2c3d4e5-f6a7-8901-bcde-f12345678901',
    nombre: 'Cobertura de Vacunación',
    descripcion: 'Porcentaje de población con esquema completo',
    activo: true,
    creado_en: '2026-02-20T14:00:00Z',
  },
  {
    id: 'c3d4e5f6-a7b8-9012-cdef-123456789012',
    nombre: 'Tasa de Natalidad',
    descripcion: null,
    activo: true,
    creado_en: '2026-03-10T08:45:00Z',
  },
];

/** Mutable fixture for the indicator detail endpoint. */
let fixtureDetail: IndicadorDetail = {
  id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  nombre: 'Tasa de Mortalidad',
  descripcion: 'Mortalidad general por cada 1000 habitantes',
  activo: true,
  creado_en: '2026-01-15T10:30:00Z',
  versiones: [
    {
      id: 'v1a1b2c3-d4e5-f678-90ab-cdef12345678',
      indicador_id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      version: 1,
      definicion: {
        tipo: 'conteo_atenciones',
        periodo: 'mes_actual',
        evento: {
          location_uuids: ['550e8400-e29b-41d4-a716-446655440000'],
          minimo_ocurrencias: 1,
          diagnosticos: [
            {
              concepto_uuids: ['aaaa1111-bbbb-2222-cccc-333333333333'],
              tipo_diagnostico: 'definitivo',
            },
          ],
        },
      },
      creado_en: '2026-01-15T10:30:00Z',
    },
    {
      id: 'v2a1b2c3-d4e5-f678-90ab-cdef12345679',
      indicador_id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      version: 2,
      definicion: {
        tipo: 'conteo_pacientes',
        periodo: 'trimestre_actual',
        evento: {
          location_uuids: ['550e8400-e29b-41d4-a716-446655440000', '550e8400-e29b-41d4-a716-446655440001'],
          minimo_ocurrencias: 2,
          ordenes: [
            { concepto_uuid: '550e8400-e29b-41d4-a716-446655440002' },
            { concepto_uuid: '550e8400-e29b-41d4-a716-446655440003' },
          ],
        },
        poblacion: {
          min_anios: 18,
          max_anios_excl: 65,
          sexo: 'M',
        },
      },
      creado_en: '2026-02-01T09:00:00Z',
    },
    {
      id: 'v3a1b2c3-d4e5-f678-90ab-cdef12345680',
      indicador_id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      version: 3,
      definicion: {
        tipo: 'conteo_atenciones',
        periodo: 'anual_actual',
        evento: {
          location_uuids: [],
          minimo_ocurrencias: 1,
        },
        poblacion: {
          min_anios: 0,
          max_meses_excl: 12,
        },
      },
      creado_en: '2026-03-05T11:15:00Z',
    },
  ],
};

/**
 * Reset the fixture store to its initial state.
 * Call `resetFixtures()` in `beforeEach` so each test starts fresh.
 */
export function resetFixtures(): void {
  fixtureIndicadores.length = 0;
  fixtureIndicadores.push(
    {
      id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      nombre: 'Tasa de Mortalidad',
      descripcion: 'Mortalidad general por cada 1000 habitantes',
      activo: true,
      creado_en: '2026-01-15T10:30:00Z',
    },
    {
      id: 'b2c3d4e5-f6a7-8901-bcde-f12345678901',
      nombre: 'Cobertura de Vacunación',
      descripcion: 'Porcentaje de población con esquema completo',
      activo: true,
      creado_en: '2026-02-20T14:00:00Z',
    },
    {
      id: 'c3d4e5f6-a7b8-9012-cdef-123456789012',
      nombre: 'Tasa de Natalidad',
      descripcion: null,
      activo: true,
      creado_en: '2026-03-10T08:45:00Z',
    },
  );

  fixtureDetail = {
    id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    nombre: 'Tasa de Mortalidad',
    descripcion: 'Mortalidad general por cada 1000 habitantes',
    activo: true,
    creado_en: '2026-01-15T10:30:00Z',
    versiones: [
      {
        id: 'v1a1b2c3-d4e5-f678-90ab-cdef12345678',
        indicador_id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        version: 1,
        definicion: {
          tipo: 'conteo_atenciones',
          periodo: 'mes_actual',
          evento: {
            location_uuids: ['550e8400-e29b-41d4-a716-446655440000'],
            minimo_ocurrencias: 1,
            diagnosticos: [
              {
                concepto_uuids: ['aaaa1111-bbbb-2222-cccc-333333333333'],
                tipo_diagnostico: 'definitivo',
              },
            ],
          },
        },
        creado_en: '2026-01-15T10:30:00Z',
      },
      {
        id: 'v2a1b2c3-d4e5-f678-90ab-cdef12345679',
        indicador_id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        version: 2,
        definicion: {
          tipo: 'conteo_pacientes',
          periodo: 'semestre_actual',
          evento: {
            location_uuids: ['550e8400-e29b-41d4-a716-446655440000', '550e8400-e29b-41d4-a716-446655440001'],
            minimo_ocurrencias: 2,
            ordenes: [
              { concepto_uuid: '550e8400-e29b-41d4-a716-446655440002' },
              { concepto_uuid: '550e8400-e29b-41d4-a716-446655440003' },
            ],
          },
            poblacion: {
              min_anios: 18,
              max_anios_excl: 65,
              sexo: 'M',
            },
        },
        creado_en: '2026-02-01T09:00:00Z',
      },
      {
        id: 'v3a1b2c3-d4e5-f678-90ab-cdef12345680',
        indicador_id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        version: 3,
        definicion: {
          tipo: 'conteo_atenciones',
          periodo: 'anual_actual',
          evento: {
            location_uuids: [],
            minimo_ocurrencias: 1,
          },
          poblacion: {
            edad_min_anios: 0,
            edad_max_meses: 12,
          },
        },
        creado_en: '2026-03-05T11:15:00Z',
      },
    ],
  };
}

function paginate(
  items: Indicador[],
  page: number,
  size: number,
): PaginatedResponse<Indicador> {
  const total = items.length;
  const pages = Math.max(1, Math.ceil(total / size));
  const start = (page - 1) * size;
  const paged = items.slice(start, start + size);

  return {
    items: paged,
    total,
    page,
    size,
    pages,
  };
}

export const handlers = [
  /**
   * GET /indicadores/ — returns a paginated list of indicators.
   *
   * Supports `?page=N&size=M` query params. Defaults to page 1, size 10.
   * Returns a 502 error when `?page=999` to simulate an upstream failure.
   */
  http.get('/indicadores/', ({ request }) => {
    const url = new URL(request.url);
    const page = Number(url.searchParams.get('page')) || 1;
    const size = Number(url.searchParams.get('size')) || 10;

    // Simulate server error for edge-case testing
    if (page === 999) {
      return HttpResponse.json(
        { detail: 'Upstream service unavailable' },
        { status: 502 },
      );
    }

    const response = paginate(fixtureIndicadores, page, size);
    return HttpResponse.json(response);
  }),

  /**
   * GET /indicadores/:id — returns a single indicator with version history.
   *
   * Returns 404 when the id is '00000000-0000-0000-0000-000000000000'.
   * Returns 502 when the id is 'deadbeef-0000-0000-0000-000000000000'.
   */
  http.get('/indicadores/:id', ({ params }) => {
    const { id } = params;

    if (id === '00000000-0000-0000-0000-000000000000') {
      return HttpResponse.json(
        { detail: 'Indicador no encontrado' },
        { status: 404 },
      );
    }

    if (id === 'deadbeef-0000-0000-0000-000000000000') {
      return HttpResponse.json(
        { detail: 'Upstream service unavailable' },
        { status: 502 },
      );
    }

    if (id === fixtureDetail.id) {
      return HttpResponse.json(fixtureDetail);
    }

    // Fallback: return a minimal detail for any other known id
    const indicador = fixtureIndicadores.find((ind) => ind.id === id);
    if (indicador) {
      const detail: IndicadorDetail = { ...indicador, versiones: [] };
      return HttpResponse.json(detail);
    }

    return HttpResponse.json(
      { detail: 'Indicador no encontrado' },
      { status: 404 },
    );
  }),

  /**
   * POST /indicadores/:id/versiones — creates a new version.
   *
   * Returns 201 with the new version, appending it to fixtureDetail.versiones.
   * Returns 422 when definicion is null or missing.
   * Returns 409 when the definicion matches an existing version exactly.
   */
  http.post('/indicadores/:id/versiones', async ({ params, request }) => {
    const { id } = params;
    const body = (await request.json()) as { definicion?: Record<string, unknown> | null };

    if (id === '00000000-0000-0000-0000-000000000000') {
      return HttpResponse.json(
        { detail: 'Indicador no encontrado' },
        { status: 404 },
      );
    }

    if (body.definicion === null || body.definicion === undefined) {
      return HttpResponse.json(
        { detail: 'La definición no puede estar vacía' },
        { status: 422 },
      );
    }

    // Simulate 409 conflict for duplicate definicion on the fixture detail
    if (id === fixtureDetail.id) {
      const exists = fixtureDetail.versiones.some(
        (v) => JSON.stringify(v.definicion) === JSON.stringify(body.definicion),
      );
      if (exists) {
        return HttpResponse.json(
          { detail: 'Conflicto: ya existe una versión con esta definición' },
          { status: 409 },
        );
      }

      const nextVersion = fixtureDetail.versiones.length + 1;
      const newVersion: IndicadorVersion = {
        id: `v${nextVersion}a1b2c3-d4e5-f678-90ab-cdef1234567${nextVersion}`,
        indicador_id: id as string,
        version: nextVersion,
        definicion: body.definicion,
        creado_en: new Date().toISOString(),
      };
      fixtureDetail.versiones.push(newVersion);
      return HttpResponse.json(newVersion, { status: 201 });
    }

    // For other ids, just return a generic new version
    const newVersion: IndicadorVersion = {
      id: 'v999a1b2c3-d4e5-f678-90ab-cdef12345678',
      indicador_id: id as string,
      version: 1,
      definicion: body.definicion,
      creado_en: new Date().toISOString(),
    };
    return HttpResponse.json(newVersion, { status: 201 });
  }),

  /**
   * POST /indicadores/ — creates a new indicator.
   *
   * Returns 201 with the new indicator.
   * Returns 422 when nombre is empty.
   * Returns 502 when the body contains 'force-502' in descripcion.
   */
  http.post('/indicadores/', async ({ request }) => {
    const body = (await request.json()) as {
      nombre?: string;
      descripcion?: string | null;
      definicion?: unknown;
    };

    if (body.descripcion === 'force-502') {
      return HttpResponse.json(
        { detail: 'Upstream service unavailable' },
        { status: 502 },
      );
    }

    if (!body.nombre || body.nombre.trim() === '') {
      return HttpResponse.json(
        { detail: { field: 'nombre', message: 'El nombre es obligatorio' } },
        { status: 422 },
      );
    }

    const newIndicador: Indicador = {
      id: 'new-indicador-uuid-1234-5678-90ab-cdef12345678',
      nombre: body.nombre,
      descripcion: body.descripcion ?? null,
      activo: true,
      creado_en: new Date().toISOString(),
    };

    fixtureIndicadores.push(newIndicador);
    return HttpResponse.json(newIndicador, { status: 201 });
  }),

  /**
   * PUT /indicadores/:id — updates indicator metadata.
   *
   * When definicion is present and semantically differs from the latest
   * version, appends a new IndicadorVersion to fixtureDetail.versiones
   * (mirroring backend auto-versioning behaviour).
   *
   * Returns 200 with updated indicator.
   * Returns 404 for '00000000-0000-0000-0000-000000000000'.
   * Returns 422 when nombre is empty.
   * Returns 502 when descripcion is 'force-502'.
   */
  http.put('/indicadores/:id', async ({ params, request }) => {
    const { id } = params;
    const body = (await request.json()) as {
      nombre?: string;
      descripcion?: string | null;
      definicion?: Record<string, unknown>;
    };

    if (id === '00000000-0000-0000-0000-000000000000') {
      return HttpResponse.json(
        { detail: 'Indicador no encontrado' },
        { status: 404 },
      );
    }

    if (body.descripcion === 'force-502') {
      return HttpResponse.json(
        { detail: 'Upstream service unavailable' },
        { status: 502 },
      );
    }

    if (!body.nombre || body.nombre.trim() === '') {
      return HttpResponse.json(
        { detail: { field: 'nombre', message: 'El nombre es obligatorio' } },
        { status: 422 },
      );
    }

    const indicador = fixtureIndicadores.find((ind) => ind.id === id);
    if (!indicador) {
      return HttpResponse.json(
        { detail: 'Indicador no encontrado' },
        { status: 404 },
      );
    }

    // Auto-versioning: if definicion differs from latest version, append a new one
    if (
      id === fixtureDetail.id &&
      body.definicion !== undefined
    ) {
      const latestVersion =
        fixtureDetail.versiones[fixtureDetail.versiones.length - 1];
      const sortedLatest = JSON.stringify(latestVersion.definicion, Object.keys(latestVersion.definicion).sort());
      const sortedBody = JSON.stringify(body.definicion, Object.keys(body.definicion).sort());

      if (sortedLatest !== sortedBody) {
        const nextVersion = fixtureDetail.versiones.length + 1;
        const newVersion: IndicadorVersion = {
          id: `v${nextVersion}a1b2c3-d4e5-f678-90ab-cdef1234567${nextVersion}`,
          indicador_id: id as string,
          version: nextVersion,
          definicion: body.definicion,
          creado_en: new Date().toISOString(),
        };
        fixtureDetail.versiones.push(newVersion);
      }
    }

    indicador.nombre = body.nombre;
    indicador.descripcion = body.descripcion ?? null;
    return HttpResponse.json(indicador);
  }),

  /**
   * GET /indicadores/:id/preview-sql — returns the generated SQL preview.
   *
   * Supports optional ?version_id= query param. When omitted, defaults
   * to the latest version. Returns a parameterized SQL string, params dict,
   * and computed period dates.
   */
  http.get('/indicadores/:id/preview-sql', ({ params, request }) => {
    const { id } = params;
    const url = new URL(request.url);
    const versionId = url.searchParams.get('version_id');

    if (id === '00000000-0000-0000-0000-000000000000') {
      return HttpResponse.json(
        { detail: 'Indicador no encontrado' },
        { status: 404 },
      );
    }

    // Build a realistic SQL preview from the fixture definitions
    let sql: string;
    let sqlParams: Record<string, unknown>;
    let periodoInicio: string;
    let periodoFin: string;
    let versionNum: number;

    if (versionId === 'v1a1b2c3-d4e5-f678-90ab-cdef12345678') {
      versionNum = 1;
      periodoInicio = '2026-05-01';
      periodoFin = '2026-05-25';
      sql = 'SELECT COUNT(*) as valor\nFROM encounter e\nWHERE e.encounter_datetime BETWEEN %(inicio)s AND %(fin)s\n  AND e.voided = 0\n  AND l.uuid IN (%(loc_0)s)\nJOIN location l ON e.location_id = l.location_id\nJOIN encounter_diagnosis ed ON ed.encounter_id = e.encounter_id AND ed.voided = 0\nJOIN concept c ON c.concept_id = ed.diagnosis_coded\nAND (c.uuid IN (%(diag_uuid_0_0)s))\nAND ed.certainty = %(diag_certainty)s;';
      sqlParams = {
        inicio: '2026-05-01',
        fin: '2026-05-25',
        loc_0: '550e8400-e29b-41d4-a716-446655440000',
        diag_uuid_0_0: 'aaaa1111-bbbb-2222-cccc-333333333333',
        diag_certainty: 'CONFIRMED',
      };
    } else if (versionId === 'v2a1b2c3-d4e5-f678-90ab-cdef12345679') {
      versionNum = 2;
      periodoInicio = '2026-04-01';
      periodoFin = '2026-05-25';
      sql = 'SELECT COUNT(DISTINCT p.person_id) as valor\nFROM person p\nJOIN encounter e ON e.patient_id = p.person_id\nJOIN location l ON e.location_id = l.location_id\nWHERE e.encounter_datetime BETWEEN %(inicio)s AND %(fin)s\n  AND e.voided = 0\n  AND p.voided = 0\n  AND l.uuid IN (%(loc_0)s, %(loc_1)s)\n  AND DATE_ADD(p.birthdate, INTERVAL %(min_anios)s YEAR) <= %(inicio)s\n  AND DATE_ADD(p.birthdate, INTERVAL %(max_anios_excl)s YEAR) > %(inicio)s\n  AND p.gender = %(sexo)s\n  AND EXISTS (\n    SELECT 1 FROM orders o0\n    WHERE o0.encounter_id = e.encounter_id\n      AND o0.concept_id = %(ord_0)s\n      AND o0.voided = 0\n)\nAND EXISTS (\n    SELECT 1 FROM orders o1\n    WHERE o1.encounter_id = e.encounter_id\n      AND o1.concept_id = %(ord_1)s\n      AND o1.voided = 0\n)\nAND e.patient_id IN (\nSELECT e.patient_id\nFROM encounter e\nJOIN location l ON e.location_id = l.location_id\nJOIN person p ON e.patient_id = p.person_id\nWHERE e.encounter_datetime BETWEEN %(inicio)s AND %(fin)s\n  AND e.voided = 0\n  AND l.uuid IN (%(loc_0)s, %(loc_1)s)\n  AND p.voided = 0\n  AND DATE_ADD(p.birthdate, INTERVAL %(min_anios)s YEAR) <= %(inicio)s\n  AND DATE_ADD(p.birthdate, INTERVAL %(max_anios_excl)s YEAR) > %(inicio)s\n  AND p.gender = %(sexo)s\n  AND EXISTS (\n    SELECT 1 FROM orders o0\n    WHERE o0.encounter_id = e.encounter_id\n      AND o0.concept_id = %(ord_0)s\n      AND o0.voided = 0\n)\nAND EXISTS (\n    SELECT 1 FROM orders o1\n    WHERE o1.encounter_id = e.encounter_id\n      AND o1.concept_id = %(ord_1)s\n      AND o1.voided = 0\n)\nGROUP BY e.patient_id\nHAVING COUNT(e.encounter_id) >= %(min_oc)s\n);';
      sqlParams = {
        inicio: '2026-04-01',
        fin: '2026-05-25',
        loc_0: '550e8400-e29b-41d4-a716-446655440000',
        loc_1: '550e8400-e29b-41d4-a716-446655440001',
        min_anios: 18,
        max_anios_excl: 65,
        sexo: 'M',
        min_oc: 2,
        ord_0: 42,
        ord_1: 99,
      };
    } else {
      // Default: latest version (v3)
      versionNum = 3;
      periodoInicio = '2026-01-01';
      periodoFin = '2026-05-25';
      sql = 'SELECT COUNT(*) as valor\nFROM encounter e\nWHERE e.encounter_datetime BETWEEN %(inicio)s AND %(fin)s\n  AND e.voided = 0\nJOIN person p ON e.patient_id = p.person_id\nAND p.voided = 0\nAND DATEDIFF(%(inicio)s, p.birthdate) >= %(min_dias)s\nAND DATE_ADD(p.birthdate, INTERVAL %(max_meses_excl)s MONTH) > %(inicio)s;';
      sqlParams = {
        inicio: '2026-01-01',
        fin: '2026-05-25',
        min_dias: 0,
        max_meses_excl: 12,
      };
    }

    const preview: IndicadorSQLPreview = {
      sql,
      params: sqlParams,
      periodo_inicio: periodoInicio,
      periodo_fin: periodoFin,
      version_id: (versionId as string) ?? 'v3a1b2c3-d4e5-f678-90ab-cdef12345680',
      version_num: versionNum,
    };

    return HttpResponse.json(preview);
  }),

  /**
   * GET /conceptos/encounter-types — returns encounter type options.
   */
  http.get('/conceptos/encounter-types', () => {
    return HttpResponse.json([
      { uuid: '550e8400-e29b-41d4-a716-446655440000', display: 'Consulta' },
      { uuid: '550e8400-e29b-41d4-a716-446655440001', display: 'Hospitalización' },
    ]);
  }),

  /**
   * GET /conceptos/diagnosticos/buscar — returns diagnosis concepts.
   *
   * Supports testing: with CIE-10 code, without code,
   * code-only concept (nombre falls back to display),
   * empty results when q matches "zzz_no_existe".
   */
  http.get('/conceptos/diagnosticos/buscar', ({ request }) => {
    const url = new URL(request.url);
    const q = url.searchParams.get('q') || '';

    // Edge case: request with empty q returns empty (shouldn't happen in normal flow)
    if (!q || q.trim().length === 0) {
      return HttpResponse.json([]);
    }

    // Simulate no results
    if (q === 'zzz_no_existe') {
      return HttpResponse.json([]);
    }

    const results: DiagnosticoOption[] = [
      {
        uuid: 'aaaa1111-bbbb-2222-cccc-333333333333',
        codigo: 'A379',
        nombre: 'TOS FERINA',
      },
      {
        uuid: 'bbbb2222-cccc-3333-dddd-444444444444',
        nombre: 'CONSULTA EXTERNA',
      },
      {
        uuid: 'cccc3333-dddd-4444-eeee-555555555555',
        codigo: 'J180',
        nombre: 'BRONCONEUMONIA NO ESPECIFICADA',
      },
    ];

    // Filter results by search query
    const lowerQ = q.toLowerCase();
    const filtered = results.filter(
      (r) =>
        r.nombre.toLowerCase().includes(lowerQ) ||
        r.codigo?.toLowerCase().includes(lowerQ),
    );

    return HttpResponse.json(filtered);
  }),

  /**
   * GET /conceptos/locations — returns location search results.
   *
   * Returns matching locations filtered by query.
   * Returns empty results when q is empty or matches "zzz_no_existe".
   */
  http.get('/conceptos/locations', ({ request }) => {
    const url = new URL(request.url);
    const q = url.searchParams.get('q') || '';

    if (!q || q.trim().length === 0) {
      return HttpResponse.json(
        { detail: "El parámetro 'q' es obligatorio y no puede estar vacío" },
        { status: 400 },
      );
    }

    if (q === 'zzz_no_existe') {
      return HttpResponse.json([]);
    }

    const allLocations: LocationOption[] = [
      { uuid: '550e8400-e29b-41d4-a716-446655440000', display: 'Consulta Externa' },
      { uuid: '550e8400-e29b-41d4-a716-446655440001', display: 'Hospitalización' },
      { uuid: '660e8400-e29b-41d4-a716-446655440002', display: 'Emergencia' },
    ];

    const lowerQ = q.toLowerCase();
    const filtered = allLocations.filter((loc) =>
      loc.display.toLowerCase().includes(lowerQ),
    );

    return HttpResponse.json(filtered);
  }),

  /**
   * GET /conceptos/buscar — returns concept search results by class.
   *
   * Accepts `?q={query}&clase={clase}` params.
   * Returns empty results when q matches "zzz_no_existe".
   */
  http.get('/conceptos/buscar', ({ request }) => {
    const url = new URL(request.url);
    const q = url.searchParams.get('q') || '';
    const clase = url.searchParams.get('clase') || '';

    if (!q || q.trim().length === 0) {
      return HttpResponse.json([]);
    }

    if (q === 'zzz_no_existe') {
      return HttpResponse.json([]);
    }

    const results: OrdenOption[] = [
      { uuid: 'ord-1111-2222-3333-444444444444', display: 'Hemoglobina' },
      { uuid: 'ord-5555-6666-7777-888888888888', display: 'Urocultivo' },
      { uuid: 'ord-9999-aaaa-bbbb-cccccccccccc', display: 'Glucosa' },
    ];

    const lowerQ = q.toLowerCase();
    const filtered = results.filter(
      (r) => r.display.toLowerCase().includes(lowerQ),
    );

    return HttpResponse.json(filtered);
  }),

  /**
   * GET /conceptos/locations/resolve — batch resolve location UUIDs.
   *
   * Accepts `?uuids=uuid1,uuid2,...`. Returns only matching locations.
   * UUIDs not in the fixture map are silently omitted.
   */
  http.get('/conceptos/locations/resolve', ({ request }) => {
    const url = new URL(request.url);
    const uuidsParam = url.searchParams.get('uuids') || '';
    const uuidList = uuidsParam
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    const locationMap: Record<string, string> = {
      '550e8400-e29b-41d4-a716-446655440000': 'Consulta Externa',
      '550e8400-e29b-41d4-a716-446655440001': 'Hospitalización',
      '660e8400-e29b-41d4-a716-446655440002': 'Emergencia',
    };

    const resolved: LocationOption[] = uuidList
      .filter((uid) => locationMap[uid])
      .map((uid) => ({ uuid: uid, display: locationMap[uid] }));

    return HttpResponse.json(resolved);
  }),

  /**
   * GET /conceptos/diagnosticos/resolve — batch resolve diagnosis concept UUIDs.
   *
   * Accepts `?uuids=uuid1,uuid2,...`. Returns only matching concepts
   * with CIE-10 code and name. UUIDs not in the fixture map are omitted.
   */
  http.get('/conceptos/diagnosticos/resolve', ({ request }) => {
    const url = new URL(request.url);
    const uuidsParam = url.searchParams.get('uuids') || '';
    const uuidList = uuidsParam
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    const diagMap: Record<string, { codigo?: string; nombre: string }> = {
      'aaaa1111-bbbb-2222-cccc-333333333333': {
        codigo: 'A379',
        nombre: 'TOS FERINA',
      },
      'bbbb2222-cccc-3333-dddd-444444444444': {
        nombre: 'CONSULTA EXTERNA',
      },
      'cccc3333-dddd-4444-eeee-555555555555': {
        codigo: 'J180',
        nombre: 'BRONCONEUMONIA NO ESPECIFICADA',
      },
    };

    const resolved: DiagnosticoOption[] = uuidList
      .filter((uid) => diagMap[uid])
      .map((uid) => {
        const entry = diagMap[uid];
        return {
          uuid: uid,
          ...(entry.codigo ? { codigo: entry.codigo } : {}),
          nombre: entry.nombre,
        };
      });

    return HttpResponse.json(resolved);
  }),

  /**
   * DELETE /indicadores/:id — soft-deletes an indicator.
   *
   * Returns 204 on success (indicator found in fixture store).
   * Returns 404 when the id is '00000000-0000-0000-0000-000000000000'.
   * Returns 502 when the id is '50250250-2502-4502-8502-502502502502'.
   */
  http.delete('/indicadores/:id', ({ params }) => {
    const { id } = params;

    // Special test UUID that triggers a 502 server error
    if (id === '50250250-2502-4502-8502-502502502502') {
      return HttpResponse.json(
        { detail: 'Upstream service unavailable' },
        { status: 502 },
      );
    }

    // Special test UUID that always triggers a 404
    if (id === '00000000-0000-0000-0000-000000000000') {
      return HttpResponse.json(
        { detail: 'Indicador no encontrado' },
        { status: 404 },
      );
    }

    const idx = fixtureIndicadores.findIndex((ind) => ind.id === id);
    if (idx !== -1) {
      fixtureIndicadores.splice(idx, 1);
    }

    return new HttpResponse(null, { status: 204 });
  }),

  /**
   * GET /resultados/ — returns a paginated list of indicator results.
   *
   * Supports `?indicador_id=&periodo_inicio=&periodo_fin=&page=N&size=M`.
   * Defaults to page 1, size 10.
   */
  http.get('/resultados/', ({ request }) => {
    const url = new URL(request.url);
    const page = Number(url.searchParams.get('page')) || 1;
    const size = Number(url.searchParams.get('size')) || 10;

    // Simulate server error for edge-case testing
    if (page === 999) {
      return HttpResponse.json(
        { detail: 'Upstream service unavailable' },
        { status: 502 },
      );
    }

    const response: PaginatedResponse<IndicadorResultado> = {
      items: [
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
      ],
      total: 2,
      page,
      size,
      pages: 1,
    };

    return HttpResponse.json(response);
  }),

  /**
   * POST /resultados/calcular-ahora — triggers batch calculation.
   *
   * Returns success summary by default.
   * Returns error variant when the body contains `force-error: true`.
   */
  http.post('/resultados/calcular-ahora', async ({ request }) => {
    let forceError = false;
    try {
      const body = (await request.json()) as { 'force-error'?: boolean };
      forceError = body['force-error'] === true;
    } catch {
      // No body or invalid JSON — proceed with default success response
    }

    if (forceError) {
      const response: BatchCalcularNowResponse = {
        calculados: 1,
        errores: [
          {
            indicador_id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
            indicador_nombre: 'Tasa de Mortalidad',
            error: 'BOOM',
          },
        ],
        total: 2,
      };
      return HttpResponse.json(response);
    }

    const response: BatchCalcularNowResponse = {
      calculados: 2,
      errores: [],
      total: 2,
    };

    return HttpResponse.json(response);
  }),
];
