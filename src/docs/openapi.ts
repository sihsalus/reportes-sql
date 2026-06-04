/**
 * OpenAPI 3.0 specification builder for Motor de Indicadores SIH.SALUS.
 *
 * Design: Zod schemas from types/definicion.ts are the canonical source
 * of truth. This module converts them to JSON Schema via zod-to-json-schema
 * and assembles the full OpenAPI document, including all four route groups:
 * /health, /indicadores, /resultados, /conceptos.
 *
 * Route-level request/response shapes that cannot be auto-derived from Zod
 * (query params, pagination wrappers, proxy pass-throughs) are documented
 * with pragmatic inline schemas — minimal, maintainable, and accurate.
 */

import { zodToJsonSchema } from "zod-to-json-schema";
import {
  DefinicionIndicadorSchema,
  FiltrosPoblacionSchema,
  FiltrosEventoSchema,
  FiltroDiagnosticoSchema,
  FiltroOrdenSchema,
} from "../types/definicion.js";

// ── Shared response shapes ──────────────────────────────────────────────

const Error422 = {
  type: "object",
  properties: {
    detail: {
      type: "object",
      properties: {
        field: { type: "string", example: "nombre" },
        message: { type: "string", example: "nombre es obligatorio" },
      },
    },
  },
};

const Error404 = {
  type: "object",
  properties: {
    detail: { type: "string", example: "Indicador no encontrado" },
  },
};

const Error502 = {
  type: "object",
  properties: {
    detail: { type: "string", example: "Error conectando a OpenMRS" },
  },
};

const PaginatedResponse = {
  type: "object",
  properties: {
    items: { type: "array", items: { type: "object" } },
    total: { type: "integer" },
    page: { type: "integer" },
    size: { type: "integer" },
    pages: { type: "integer" },
  },
};

// ── Zod → JSON Schema (OpenAPI 3.0 compatible) ──────────────────────────

const definicionSchema: object = zodToJsonSchema(
  DefinicionIndicadorSchema,
  { target: "openApi3" },
) as object;

const poblacionSchema: object = zodToJsonSchema(
  FiltrosPoblacionSchema,
  { target: "openApi3" },
) as object;

const eventoSchema: object = zodToJsonSchema(
  FiltrosEventoSchema,
  { target: "openApi3" },
) as object;

const diagnosticoSchema: object = zodToJsonSchema(
  FiltroDiagnosticoSchema,
  { target: "openApi3" },
) as object;

const ordenSchema: object = zodToJsonSchema(
  FiltroOrdenSchema,
  { target: "openApi3" },
) as object;

// ── OpenAPI document ────────────────────────────────────────────────────

export const openapiSpec = {
  openapi: "3.0.3",
  info: {
    title: "Motor de Indicadores SIH.SALUS",
    version: "0.1.0",
    description:
      "Microservicio para definición, versionado y cálculo de indicadores clínicos. " +
      "Provee CRUD de indicadores con versionado semántico, cálculo bajo demanda, " +
      "y proxy a conceptos y ubicaciones de OpenMRS.",
  },
  servers: [
    { url: "http://localhost:8000", description: "Desarrollo local" },
  ],
  tags: [
    { name: "Health", description: "Monitoreo del servicio" },
    {
      name: "Indicadores",
      description: "CRUD de indicadores con versionado automático",
    },
    {
      name: "Resultados",
      description: "Consulta y cálculo de resultados de indicadores",
    },
    {
      name: "Conceptos",
      description: "Proxy a conceptos, ubicaciones y diagnósticos de OpenMRS",
    },
  ],
  paths: {
    // ── Health ──────────────────────────────────────────────────────────
    "/health": {
      get: {
        tags: ["Health"],
        summary: "Verificar estado del servicio",
        operationId: "healthCheck",
        responses: {
          "200": {
            description: "Servicio operativo",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: { status: { type: "string", example: "ok" } },
                },
              },
            },
          },
        },
      },
    },

    // ── Indicadores ─────────────────────────────────────────────────────
    "/indicadores": {
      get: {
        tags: ["Indicadores"],
        summary: "Listar indicadores activos (paginado)",
        operationId: "listIndicadores",
        parameters: [
          {
            name: "page",
            in: "query",
            schema: { type: "integer", default: 1, minimum: 1 },
            description: "Número de página (1-based)",
          },
          {
            name: "size",
            in: "query",
            schema: { type: "integer", default: 20, minimum: 1, maximum: 100 },
            description: "Registros por página (máx 100)",
          },
        ],
        responses: {
          "200": {
            description: "Lista paginada de indicadores activos",
            content: { "application/json": { schema: PaginatedResponse } },
          },
        },
      },
      post: {
        tags: ["Indicadores"],
        summary: "Crear indicador (con versión 1)",
        operationId: "createIndicador",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["nombre", "definicion"],
                properties: {
                  nombre: {
                    type: "string",
                    description: "Nombre del indicador",
                    example: "Consultas mensuales",
                  },
                  descripcion: {
                    type: "string",
                    nullable: true,
                    description: "Descripción opcional",
                  },
                  definicion: definicionSchema,
                },
              },
            },
          },
        },
        responses: {
          "201": { description: "Indicador creado con éxito" },
          "422": {
            description: "Error de validación (nombre, definicion, o location_uuids)",
            content: { "application/json": { schema: Error422 } },
          },
          "502": {
            description: "OpenMRS no disponible (validación de location_uuids)",
            content: { "application/json": { schema: Error502 } },
          },
        },
      },
    },

    "/indicadores/{id}": {
      get: {
        tags: ["Indicadores"],
        summary: "Obtener detalle de indicador (con todas sus versiones)",
        operationId: "getIndicador",
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
            description: "UUID del indicador",
          },
        ],
        responses: {
          "200": { description: "Indicador con versiones anidadas" },
          "404": {
            description: "Indicador no encontrado",
            content: { "application/json": { schema: Error404 } },
          },
        },
      },
      put: {
        tags: ["Indicadores"],
        summary:
          "Actualizar metadata del indicador (auto-versiona si cambia definicion)",
        operationId: "updateIndicador",
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["nombre"],
                properties: {
                  nombre: { type: "string" },
                  descripcion: { type: "string", nullable: true },
                  definicion: definicionSchema,
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "Indicador actualizado" },
          "404": {
            description: "Indicador no encontrado",
            content: { "application/json": { schema: Error404 } },
          },
          "422": {
            description: "Error de validación",
            content: { "application/json": { schema: Error422 } },
          },
          "502": {
            description: "OpenMRS no disponible",
            content: { "application/json": { schema: Error502 } },
          },
        },
      },
      delete: {
        tags: ["Indicadores"],
        summary: "Desactivar indicador (soft-delete)",
        operationId: "deleteIndicador",
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
        ],
        responses: {
          "204": { description: "Indicador desactivado (sin cuerpo)" },
          "404": {
            description: "Indicador no encontrado",
            content: { "application/json": { schema: Error404 } },
          },
        },
      },
    },

    "/indicadores/{id}/versiones": {
      post: {
        tags: ["Indicadores"],
        summary: "Crear nueva versión inmutable del indicador",
        operationId: "createVersion",
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["definicion"],
                properties: { definicion: definicionSchema },
              },
            },
          },
        },
        responses: {
          "201": { description: "Versión creada" },
          "404": {
            description: "Indicador no encontrado",
            content: { "application/json": { schema: Error404 } },
          },
          "409": {
            description: "Conflicto de versión (versión duplicada)",
          },
          "422": {
            description: "Error de validación",
            content: { "application/json": { schema: Error422 } },
          },
          "502": {
            description: "OpenMRS no disponible",
            content: { "application/json": { schema: Error502 } },
          },
        },
      },
    },

    "/indicadores/{id}/preview-sql": {
      get: {
        tags: ["Indicadores"],
        summary: "Previsualizar SQL que ejecutaría el indicador",
        operationId: "previewSql",
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
          {
            name: "version_id",
            in: "query",
            schema: { type: "string", format: "uuid" },
            description:
              "UUID de versión específica (opcional; default: última versión). También acepta versionId (camelCase).",
          },
          {
            name: "versionId",
            in: "query",
            schema: { type: "string", format: "uuid" },
            description:
              "Alias camelCase de version_id. Si ambos están presentes, versionId tiene precedencia.",
          },
        ],
        responses: {
          "200": {
            description: "SQL generado con parámetros y período calculado",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    sql: { type: "string", example: "SELECT COUNT(*) ..." },
                    params: { type: "object" },
                    periodo_inicio: { type: "string", format: "date" },
                    periodo_fin: { type: "string", format: "date" },
                    version_id: { type: "string", format: "uuid" },
                    version_num: { type: "integer" },
                  },
                },
              },
            },
          },
          "404": {
            description: "Indicador o versión no encontrados",
            content: { "application/json": { schema: Error404 } },
          },
        },
      },
    },

    // ── Resultados ──────────────────────────────────────────────────────
    "/resultados": {
      get: {
        tags: ["Resultados"],
        summary:
          "Listar resultados pre-calculados (filtrable por indicador y período)",
        operationId: "listResultados",
        parameters: [
          {
            name: "indicador_id",
            in: "query",
            schema: { type: "string", format: "uuid" },
            description: "Filtrar por indicador",
          },
          {
            name: "periodo_inicio",
            in: "query",
            schema: { type: "string", format: "date" },
            description: "Filtrar desde fecha (>=)",
          },
          {
            name: "periodo_fin",
            in: "query",
            schema: { type: "string", format: "date" },
            description: "Filtrar hasta fecha (<=)",
          },
          {
            name: "page",
            in: "query",
            schema: { type: "integer", default: 1, minimum: 1 },
          },
          {
            name: "size",
            in: "query",
            schema: { type: "integer", default: 20, minimum: 1, maximum: 100 },
          },
        ],
        responses: {
          "200": {
            description: "Lista paginada de resultados",
            content: { "application/json": { schema: PaginatedResponse } },
          },
        },
      },
    },

    "/resultados/calcular-ahora": {
      post: {
        tags: ["Resultados"],
        summary:
          "Ejecutar cálculo de todos los indicadores activos ahora (batch)",
        operationId: "calcularAhora",
        responses: {
          "200": {
            description: "Resumen del cálculo batch",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    calculados: {
                      type: "integer",
                      description: "Cantidad de indicadores calculados con éxito",
                    },
                    errores: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          indicador_id: { type: "string" },
                          indicador_nombre: { type: "string" },
                          error: { type: "string" },
                        },
                      },
                    },
                    total: { type: "integer", description: "Total procesado" },
                  },
                },
              },
            },
          },
        },
      },
    },

    // ── Conceptos ───────────────────────────────────────────────────────
    "/conceptos/encounter-types": {
      get: {
        tags: ["Conceptos"],
        summary: "Listar tipos de encuentro (proxy OpenMRS)",
        operationId: "listEncounterTypes",
        responses: {
          "200": {
            description: "Lista de encounter types",
            content: {
              "application/json": {
                schema: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      uuid: { type: "string", format: "uuid" },
                      display: { type: "string" },
                    },
                  },
                },
              },
            },
          },
          "502": {
            description: "Error conectando a OpenMRS",
            content: { "application/json": { schema: Error502 } },
          },
        },
      },
    },

    "/conceptos/buscar": {
      get: {
        tags: ["Conceptos"],
        summary: "Buscar conceptos en OpenMRS",
        operationId: "buscarConceptos",
        parameters: [
          {
            name: "q",
            in: "query",
            required: true,
            schema: { type: "string" },
            description: "Término de búsqueda",
          },
          {
            name: "clase",
            in: "query",
            schema: { type: "string", default: "Diagnosis" },
            description: "Clase de concepto (ej: Diagnosis, Test, Drug)",
          },
        ],
        responses: {
          "200": {
            description: "Resultados de búsqueda",
            content: {
              "application/json": {
                schema: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      uuid: { type: "string" },
                      display: { type: "string" },
                    },
                  },
                },
              },
            },
          },
          "400": {
            description: "Parámetro 'q' faltante",
          },
          "502": {
            description: "Error conectando a OpenMRS",
            content: { "application/json": { schema: Error502 } },
          },
        },
      },
    },

    "/conceptos/buscar/resolve": {
      get: {
        tags: ["Conceptos"],
        summary: "Resolver UUIDs de conceptos genéricos en batch",
        operationId: "resolveConceptos",
        parameters: [
          {
            name: "uuids",
            in: "query",
            required: true,
            schema: { type: "string" },
            description: "UUIDs separados por coma",
          },
        ],
        responses: {
          "200": {
            description:
              "Mapa UUID → display label (excluye UUIDs no encontrados)",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  additionalProperties: { type: "string" },
                  example: {
                    "a1b2c3d4-e5f6-7890-abcd-ef1234567890": "Malaria",
                  },
                },
              },
            },
          },
          "400": { description: "Parámetro 'uuids' faltante o inválido" },
          "502": {
            description: "Error conectando a OpenMRS",
            content: { "application/json": { schema: Error502 } },
          },
        },
      },
    },

    "/conceptos/diagnosticos/buscar": {
      get: {
        tags: ["Conceptos"],
        summary: "Buscar diagnósticos con extracción de código CIE-10",
        operationId: "buscarDiagnosticos",
        parameters: [
          {
            name: "q",
            in: "query",
            required: true,
            schema: { type: "string" },
            description: "Término de búsqueda",
          },
        ],
        responses: {
          "200": {
            description: "Diagnósticos encontrados (con código CIE-10 si disponible)",
            content: {
              "application/json": {
                schema: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      uuid: { type: "string" },
                      nombre: { type: "string" },
                      codigo: {
                        type: "string",
                        description: "Código CIE-10 (si detectable)",
                      },
                    },
                  },
                },
              },
            },
          },
          "400": { description: "Parámetro 'q' faltante" },
          "502": {
            description: "Error conectando a OpenMRS",
            content: { "application/json": { schema: Error502 } },
          },
        },
      },
    },

    "/conceptos/locations": {
      get: {
        tags: ["Conceptos"],
        summary: "Buscar ubicaciones (locations) en OpenMRS",
        operationId: "buscarLocations",
        parameters: [
          {
            name: "q",
            in: "query",
            required: true,
            schema: { type: "string" },
            description: "Término de búsqueda (mínimo 3 caracteres)",
          },
        ],
        responses: {
          "200": {
            description: "Ubicaciones encontradas",
            content: {
              "application/json": {
                schema: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      uuid: { type: "string" },
                      display: { type: "string" },
                    },
                  },
                },
              },
            },
          },
          "400": { description: "Parámetro 'q' faltante" },
          "502": {
            description: "Error conectando a OpenMRS",
            content: { "application/json": { schema: Error502 } },
          },
        },
      },
    },

    "/conceptos/locations/resolve": {
      get: {
        tags: ["Conceptos"],
        summary: "Resolver UUIDs de ubicaciones en batch",
        operationId: "resolveLocations",
        parameters: [
          {
            name: "uuids",
            in: "query",
            required: true,
            schema: { type: "string" },
            description: "UUIDs separados por coma",
            example:
              "a1b2c3d4-e5f6-7890-abcd-ef1234567890,b2c3d4e5-f6a7-8901-bcde-f12345678901",
          },
        ],
        responses: {
          "200": {
            description: "Ubicaciones resueltas (excluye 404 individuales)",
            content: {
              "application/json": {
                schema: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      uuid: { type: "string" },
                      display: { type: "string" },
                    },
                  },
                },
              },
            },
          },
          "400": { description: "Parámetro 'uuids' faltante o inválido" },
          "502": {
            description: "Error conectando a OpenMRS",
            content: { "application/json": { schema: Error502 } },
          },
        },
      },
    },

    "/conceptos/diagnosticos/resolve": {
      get: {
        tags: ["Conceptos"],
        summary: "Resolver UUIDs de diagnósticos en batch",
        operationId: "resolveDiagnosticos",
        parameters: [
          {
            name: "uuids",
            in: "query",
            required: true,
            schema: { type: "string" },
            description: "UUIDs separados por coma",
          },
        ],
        responses: {
          "200": {
            description: "Diagnósticos resueltos con código CIE-10",
            content: {
              "application/json": {
                schema: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      uuid: { type: "string" },
                      nombre: { type: "string" },
                      codigo: { type: "string" },
                    },
                  },
                },
              },
            },
          },
          "400": { description: "Parámetro 'uuids' faltante o inválido" },
          "502": {
            description: "Error conectando a OpenMRS",
            content: { "application/json": { schema: Error502 } },
          },
        },
      },
    },
  },

  components: {
    schemas: {
      DefinicionIndicador: definicionSchema,
      FiltrosPoblacion: poblacionSchema,
      FiltrosEvento: eventoSchema,
      FiltroDiagnostico: diagnosticoSchema,
      FiltroOrden: ordenSchema,
    },
  },
} as const;

/**
 * Build the OpenAPI spec with the correct server URL for the given base path.
 *
 * When BASE_PATH is set (e.g. "/openmrs/services/reportes-sql"), the server
 * URL includes it so Swagger UI "Try it out" targets the correct prefixed route.
 */
export function buildOpenapiSpec(basePath?: string) {
  const serverUrl = basePath
    ? `http://localhost:8000${basePath}`
    : "http://localhost:8000";
  return {
    ...openapiSpec,
    servers: [{ url: serverUrl, description: "Desarrollo local" }],
  };
}
