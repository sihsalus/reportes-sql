/**
 * MSW request handlers for API mocking in tests.
 *
 * Each handler simulates the backend REST API so tests can verify
 * loading, success, and error states without a running server.
 */

import { http, HttpResponse } from 'msw';
import type { Indicador, IndicadorDetail, IndicadorVersion, PaginatedResponse, IndicadorResultado, BatchCalcularNowResponse, DiagnosticoOption } from '@/api/types';

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
          encounter_type_uuids: ['550e8400-e29b-41d4-a716-446655440000'],
          minimo_ocurrencias: 1,
          diagnosticos: [
            {
              concepto_uuid: 'aaaa1111-bbbb-2222-cccc-333333333333',
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
        periodo: 'mes_anterior',
        evento: {
          encounter_type_uuids: ['550e8400-e29b-41d4-a716-446655440000', '550e8400-e29b-41d4-a716-446655440001'],
          minimo_ocurrencias: 2,
          ordenes: [
            { concepto_uuid: '550e8400-e29b-41d4-a716-446655440002' },
            { concepto_uuid: '550e8400-e29b-41d4-a716-446655440003' },
          ],
        },
        poblacion: {
          edad_min_anios: 18,
          edad_max_anios: 65,
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
        periodo: 'semana_actual',
        evento: {
          encounter_type_uuids: [],
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
            encounter_type_uuids: ['550e8400-e29b-41d4-a716-446655440000'],
            minimo_ocurrencias: 1,
            diagnosticos: [
              {
                concepto_uuid: 'aaaa1111-bbbb-2222-cccc-333333333333',
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
          periodo: 'mes_anterior',
          evento: {
            encounter_type_uuids: ['550e8400-e29b-41d4-a716-446655440000', '550e8400-e29b-41d4-a716-446655440001'],
            minimo_ocurrencias: 2,
            ordenes: [
              { concepto_uuid: '550e8400-e29b-41d4-a716-446655440002' },
              { concepto_uuid: '550e8400-e29b-41d4-a716-446655440003' },
            ],
          },
          poblacion: {
            edad_min_anios: 18,
            edad_max_anios: 65,
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
          periodo: 'semana_actual',
          evento: {
            encounter_type_uuids: [],
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
