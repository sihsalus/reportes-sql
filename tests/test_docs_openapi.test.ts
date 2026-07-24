/**
 * OpenAPI spec integrity tests.
 *
 * Validates that the generated OpenAPI 3.0 document is internally consistent:
 * - required top-level fields present
 * - all documented paths correspond to registere routes
 * - all $ref references resolve to defined components
 * - meta endpoints are documented
 */
import { jest } from "@jest/globals";

// Minimal mocks (same as test_app_routing)
jest.mock("../src/database/postgres.js", () => ({
  sequelize: { sync: jest.fn(), close: jest.fn(), authenticate: jest.fn(), define: jest.fn() },
  testPostgresConnection: jest.fn().mockResolvedValue(true),
  disposePostgres: jest.fn(),
}));
jest.mock("../src/database/mysql.js", () => ({
  getMysqlPool: jest.fn(() => ({ execute: jest.fn().mockResolvedValue([[]]), end: jest.fn() })),
  queryMysql: jest.fn().mockResolvedValue([]),
  disposeMysql: jest.fn(),
}));
jest.mock("../src/models/indicador.js", () => ({
  Indicador: Object.assign(jest.fn(), { create: jest.fn(), findByPk: jest.fn(), findAndCountAll: jest.fn().mockResolvedValue({ count: 0, rows: [] }), findAll: jest.fn().mockResolvedValue([]), findOne: jest.fn().mockResolvedValue(null), update: jest.fn() }),
  IndicadorVersion: Object.assign(jest.fn(), { create: jest.fn(), findOne: jest.fn().mockResolvedValue(null), findAll: jest.fn().mockResolvedValue([]), max: jest.fn().mockResolvedValue(0) }),
  IndicadorResultado: Object.assign(jest.fn(), { create: jest.fn(), findAndCountAll: jest.fn().mockResolvedValue({ count: 0, rows: [] }), findAll: jest.fn().mockResolvedValue([]), findOne: jest.fn().mockResolvedValue(null) }),
}));
jest.mock("../src/validators/openmrs.js", () => ({
  validarDefinicionLocationUuids: jest.fn().mockResolvedValue([]),
  resolveConceptMap: jest.fn().mockResolvedValue({}),
  validarLocations: jest.fn().mockResolvedValue([]),
}));
jest.mock("../src/seed/default-indicador.js", () => ({
  seedDefaultIndicador: jest.fn().mockResolvedValue({ indicatorCreated: false, versionCreated: false, indicadorId: "seed-id" }),
  SEEDED_INDICADOR_NOMBRE: "seed/default-indicator",
  DEFAULT_DEFINICION: {},
}));
global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: jest.fn().mockResolvedValue({ results: [] }), text: jest.fn().mockResolvedValue("") }) as unknown as typeof fetch;

import supertest from "supertest";
import { createApp } from "../src/main.js";

// ── Types ──────────────────────────────────────────────────────────────────

interface OpenApiSpec {
  openapi: string;
  info: { title: string; version: string };
  servers: Array<{ url: string }>;
  paths: Record<string, Record<string, unknown>>;
  components?: {
    schemas?: Record<string, unknown>;
    responses?: Record<string, unknown>;
    parameters?: Record<string, unknown>;
  };
}

function makeRequest() {
  return supertest(createApp(""));
}

let spec: OpenApiSpec;

beforeAll(async () => {
  const res = await makeRequest().get("/docs/openapi.json");
  spec = res.body as OpenApiSpec;
});

// ── Top-level structure ────────────────────────────────────────────────────

describe("OpenAPI spec — structure", () => {
  test("has openapi version 3.0.x", () => {
    expect(spec.openapi).toMatch(/^3\.0\.\d/);
  });

  test("has info with title and version", () => {
    expect(spec.info.title).toBeTruthy();
    expect(spec.info.version).toBeTruthy();
  });

  test("has at least one server URL", () => {
    expect(spec.servers.length).toBeGreaterThan(0);
    expect(spec.servers[0].url).toBeTruthy();
  });
});

// ── Path coverage ──────────────────────────────────────────────────────────

describe("OpenAPI spec — paths", () => {
  const paths = () => Object.keys(spec.paths);

  test("documents health endpoint", () => {
    expect(paths()).toContain("/health");
  });

  test("documents all indicadores CRUD routes", () => {
    expect(paths()).toContain("/indicadores");
    expect(paths()).toContain("/indicadores/{id}");
    expect(paths()).toContain("/indicadores/{id}/versiones");
    expect(paths()).toContain("/indicadores/{id}/preview-sql");
  });

  test("documents all resultados routes", () => {
    expect(paths()).toContain("/resultados");
    expect(paths()).toContain("/resultados/calcular-ahora");
    expect(paths()).toContain("/resultados/recalcular-anio");
    expect(paths()).toContain("/resultados/series");
  });

  test("documents all conceptos routes", () => {
    expect(paths()).toContain("/conceptos/buscar");
    expect(paths()).toContain("/conceptos/buscar/resolve");
    expect(paths()).toContain("/conceptos/encounter-types");
    expect(paths()).toContain("/conceptos/diagnosticos/buscar");
    expect(paths()).toContain("/conceptos/diagnosticos/resolve");
    expect(paths()).toContain("/conceptos/locations");
    expect(paths()).toContain("/conceptos/locations/resolve");
  });

  test("documents metas routes", () => {
    expect(paths()).toContain("/metas");
  });

  test("every documented path has at least one HTTP method", () => {
    for (const [pathKey, methods] of Object.entries(spec.paths)) {
      const methodKeys = Object.keys(methods as Record<string, unknown>);
      expect(methodKeys.length).toBeGreaterThan(0);
      // All methods should be valid HTTP verbs
      const validVerbs = ["get", "post", "put", "delete", "patch", "options", "head"];
      for (const m of methodKeys) {
        expect(validVerbs).toContain(m);
      }
    }
  });

  test("every documented path has responses", () => {
    for (const [pathKey, methods] of Object.entries(spec.paths)) {
      for (const [method, operation] of Object.entries(methods as Record<string, { responses?: Record<string, unknown> }>)) {
        expect(operation.responses).toBeDefined();
        const responseCodes = Object.keys(operation.responses!);
        expect(responseCodes.length).toBeGreaterThan(0);
      }
    }
  });
});

// ── Component references ───────────────────────────────────────────────────

describe("OpenAPI spec — components", () => {
  test("has components section", () => {
    expect(spec.components).toBeDefined();
  });

  test("has schemas defined", () => {
    expect(spec.components?.schemas).toBeDefined();
    const schemaKeys = Object.keys(spec.components!.schemas!);
    expect(schemaKeys.length).toBeGreaterThan(0);
  });

  test("key schemas are defined", () => {
    const schemas = spec.components?.schemas ?? {};
    // Core indicator schemas
    expect(schemas).toHaveProperty("DefinicionIndicador");
    expect(schemas).toHaveProperty("FiltrosPoblacion");
    expect(schemas).toHaveProperty("FiltrosEvento");
    expect(schemas).toHaveProperty("FiltroDiagnostico");
    expect(schemas).toHaveProperty("FiltroOrden");
  });

  test("all $ref references resolve to defined components", () => {
    const schemas = spec.components?.schemas ?? {};
    const responses = spec.components?.responses ?? {};
    const parameters = spec.components?.parameters ?? {};

    const specJson = JSON.stringify(spec);
    const refPattern = /"\$ref"\s*:\s*"#\/components\/(schemas|responses|parameters)\/([^"]+)"/g;
    let match: RegExpExecArray | null;

    const unresolved: string[] = [];
    while ((match = refPattern.exec(specJson)) !== null) {
      const [, componentType, name] = match;
      const registry = componentType === "schemas" ? schemas
        : componentType === "responses" ? responses
        : parameters;
      
      if (!(name in (registry as Record<string, unknown>))) {
        unresolved.push(`#/components/${componentType}/${name}`);
      }
    }

    expect(unresolved).toEqual([]);
  });
});

// ── BASE_PATH server URL ───────────────────────────────────────────────────

describe("OpenAPI spec — server URL with BASE_PATH", () => {
  test("empty base path defaults to root server URL", () => {
    expect(spec.servers[0].url).toBe("http://localhost:8000");
  });

  test("prefixed base path includes prefix in server URL", async () => {
    const prefixedRes = await supertest(createApp("/api/v2")).get("/api/v2/docs/openapi.json");
    expect(prefixedRes.status).toBe(200);
    const prefixedSpec = prefixedRes.body as OpenApiSpec;
    expect(prefixedSpec.servers[0].url).toBe("http://localhost:8000/api/v2");
  });
});
