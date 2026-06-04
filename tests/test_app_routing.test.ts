/**
 * App-level routing tests for BASE_PATH support.
 *
 * Tests that createApp produces an Express app with correct route
 * registration for both default (no base path) and prefixed (gateway)
 * deployments. Uses mocked database modules to avoid real connections.
 *
 * Scenarios:
 *   - default routing with BASE_PATH unset
 *   - prefixed routing with BASE_PATH=/openmrs/services/reportes-sql
 *   - unprefixed /health works when BASE_PATH is set
 *   - at least one non-health prefixed endpoint
 *   - normalization edge cases (trailing slash, no leading slash, whitespace)
 */

// ── Mock factories (hoisted — before any imports) ──────────────────────

const mockSequelizeSync = jest.fn().mockResolvedValue(undefined);
const mockSequelizeClose = jest.fn().mockResolvedValue(undefined);
const mockSequelizeAuthenticate = jest.fn().mockResolvedValue(undefined);

const mockFindAndCountAll = jest.fn().mockResolvedValue({ count: 0, rows: [] });
const mockFindByPk = jest.fn().mockResolvedValue(null);
const mockModelCreate = jest.fn().mockResolvedValue({ toJSON: () => ({ id: "mock-id" }) });
const mockFindOne = jest.fn().mockResolvedValue(null);
const mockFindAll = jest.fn().mockResolvedValue([]);
const mockMax = jest.fn().mockResolvedValue(0);
const mockModelUpdate = jest.fn().mockResolvedValue(undefined);

jest.mock("../src/database/postgres.js", () => ({
  sequelize: {
    sync: (...args: unknown[]) => mockSequelizeSync(...args),
    close: (...args: unknown[]) => mockSequelizeClose(...args),
    authenticate: (...args: unknown[]) => mockSequelizeAuthenticate(...args),
    define: jest.fn(),
  },
  testPostgresConnection: jest.fn().mockResolvedValue(true),
  disposePostgres: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../src/database/mysql.js", () => ({
  getMysqlPool: jest.fn(() => ({
    execute: jest.fn().mockResolvedValue([[]]),
    end: jest.fn().mockResolvedValue(undefined),
  })),
  disposeMysql: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../src/models/indicador.js", () => ({
  Indicador: Object.assign(
    (...args: unknown[]) => mockModelCreate(...args),
    {
      create: (...args: unknown[]) => mockModelCreate(...args),
      findByPk: (...args: unknown[]) => mockFindByPk(...args),
      findAndCountAll: (...args: unknown[]) => mockFindAndCountAll(...args),
      findAll: (...args: unknown[]) => mockFindAll(...args),
      findOne: (...args: unknown[]) => mockFindOne(...args),
      update: (...args: unknown[]) => mockModelUpdate(...args),
    },
  ),
  IndicadorVersion: Object.assign(
    (...args: unknown[]) => mockModelCreate(...args),
    {
      create: (...args: unknown[]) => mockModelCreate(...args),
      findOne: (...args: unknown[]) => mockFindOne(...args),
      findAll: (...args: unknown[]) => mockFindAll(...args),
      max: (...args: unknown[]) => mockMax(...args),
    },
  ),
  IndicadorResultado: Object.assign(
    (...args: unknown[]) => mockModelCreate(...args),
    {
      create: (...args: unknown[]) => mockModelCreate(...args),
      findAndCountAll: (...args: unknown[]) => mockFindAndCountAll(...args),
      findAll: (...args: unknown[]) => mockFindAll(...args),
      findOne: (...args: unknown[]) => mockFindOne(...args),
    },
  ),
}));

jest.mock("../src/validators/openmrs.js", () => ({
  validarDefinicionLocationUuids: jest.fn().mockResolvedValue([]),
  resolveConceptMap: jest.fn().mockResolvedValue({}),
  validarLocations: jest.fn().mockResolvedValue([]),
}));

jest.mock("../src/seed/default-indicador.js", () => ({
  seedDefaultIndicador: jest.fn().mockResolvedValue({
    indicatorCreated: false,
    versionCreated: false,
    indicadorId: "seed-id",
  }),
  SEEDED_INDICADOR_NOMBRE: "seed/default-indicator",
  DEFAULT_DEFINICION: {},
}));

// Mock global fetch for conceptos proxy routes
const mockFetch = jest.fn().mockResolvedValue({
  ok: true,
  status: 200,
  json: jest.fn().mockResolvedValue({ results: [] }),
  text: jest.fn().mockResolvedValue(""),
});
global.fetch = mockFetch as unknown as typeof fetch;

import { jest } from "@jest/globals";
import supertest from "supertest";
import type { Express } from "express";
import { createApp } from "../src/main.js";
import { normalizeBasePath } from "../src/config/index.js";

// ── Helpers ────────────────────────────────────────────────────────────

function requestFor(basePath: string) {
  const app: Express = createApp(normalizeBasePath(basePath));
  return { app, request: supertest(app) };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockFindAndCountAll.mockResolvedValue({ count: 0, rows: [] });
  mockFindByPk.mockResolvedValue(null);
  mockFindOne.mockResolvedValue(null);
  mockFindAll.mockResolvedValue([]);
});

// ── Normalization unit tests ────────────────────────────────────────────

describe("normalizeBasePath", () => {
  it("returns empty string for undefined", () => {
    expect(normalizeBasePath(undefined)).toBe("");
  });

  it("returns empty string for empty string", () => {
    expect(normalizeBasePath("")).toBe("");
  });

  it("returns empty string for whitespace-only", () => {
    expect(normalizeBasePath("   ")).toBe("");
  });

  it("adds leading slash when missing", () => {
    expect(normalizeBasePath("openmrs/services/reportes-sql")).toBe(
      "/openmrs/services/reportes-sql",
    );
  });

  it("strips trailing slash", () => {
    expect(normalizeBasePath("/openmrs/services/reportes-sql/")).toBe(
      "/openmrs/services/reportes-sql",
    );
  });

  it("preserves a single slash as-is", () => {
    expect(normalizeBasePath("/")).toBe("/");
  });

  it("trims whitespace and normalizes", () => {
    expect(normalizeBasePath("  /prefix/  ")).toBe("/prefix");
  });

  it("returns clean path for already-normalized value", () => {
    expect(normalizeBasePath("/openmrs/services/reportes-sql")).toBe(
      "/openmrs/services/reportes-sql",
    );
  });
});

// ── Default routing (BASE_PATH unset) ───────────────────────────────────

describe("default routing — BASE_PATH empty", () => {
  const { request } = requestFor("");

  it("serves /health at root", async () => {
    const res = await request.get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });

  it("serves /indicadores at root", async () => {
    const res = await request.get("/indicadores");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("items");
    expect(res.body).toHaveProperty("total");
  });

  it("serves /resultados at root", async () => {
    const res = await request.get("/resultados");
    expect(res.status).toBe(200);
  });

  it("serves /docs at root", async () => {
    const res = await request.get("/docs/");
    // swagger-ui-express redirects /docs to /docs/
    expect(res.status).toBe(200);
  });

  it("serves /docs/openapi.json at root", async () => {
    const res = await request.get("/docs/openapi.json");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("openapi");
    expect(res.body).toHaveProperty("info");
    expect(res.body).toHaveProperty("paths");
    // Default server URL has no prefix
    expect(res.body.servers[0].url).toBe("http://localhost:8000");
  });

  it("returns 404 for unknown route", async () => {
    const res = await request.get("/nonexistent");
    expect(res.status).toBe(404);
  });
});

// ── Prefixed routing (BASE_PATH set) ────────────────────────────────────

describe("prefixed routing — BASE_PATH=/openmrs/services/reportes-sql", () => {
  const prefix = "/openmrs/services/reportes-sql";
  const { request } = requestFor(prefix);

  it("serves /health at root (unprefixed gateway probe)", async () => {
    const res = await request.get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });

  it("serves /health at prefixed path too", async () => {
    const res = await request.get(`${prefix}/health`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });

  it("serves /indicadores at prefixed path", async () => {
    const res = await request.get(`${prefix}/indicadores`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("items");
    expect(res.body).toHaveProperty("total");
  });

  it("serves /resultados at prefixed path", async () => {
    const res = await request.get(`${prefix}/resultados`);
    expect(res.status).toBe(200);
  });

  it("serves /conceptos at prefixed path", async () => {
    // /conceptos/encounter-types uses fetch to OpenMRS (mocked)
    const res = await request.get(`${prefix}/conceptos/encounter-types`);
    expect(res.status).toBe(200);
  });

  it("serves /docs at prefixed path", async () => {
    const res = await request.get(`${prefix}/docs/`);
    expect(res.status).toBe(200);
  });

  it("serves /docs/openapi.json at prefixed path with correct server URL", async () => {
    const res = await request.get(`${prefix}/docs/openapi.json`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("openapi");
    // Server URL includes the prefix so Swagger "Try it out" works
    expect(res.body.servers[0].url).toBe(
      `http://localhost:8000${prefix}`,
    );
  });

  it("returns 404 for unprefixed business routes", async () => {
    const res = await request.get("/indicadores");
    expect(res.status).toBe(404);
  });

  it("returns 404 for unprefixed /resultados", async () => {
    const res = await request.get("/resultados");
    expect(res.status).toBe(404);
  });
});

// ── Normalization edge cases in routing ─────────────────────────────────

describe("routing normalization edge cases", () => {
  it("trailing-slash prefix is handled (Express normalizes)", async () => {
    // Pass already-normalized value — Express handles the rest
    const { request } = requestFor("/prefix/"); // normalizeBasePath strips trailing
    const res = await request.get("/prefix/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });

  it("root-prefixed /health does not interfere with prefix /health", async () => {
    const { request } = requestFor("/api");
    // Root health
    const rootRes = await request.get("/health");
    expect(rootRes.status).toBe(200);
    // Prefixed health
    const prefixedRes = await request.get("/api/health");
    expect(prefixedRes.status).toBe(200);
  });

  it("empty base path mounts routes at root", async () => {
    const { request } = requestFor("");
    const res = await request.get("/indicadores");
    expect(res.status).toBe(200);
  });
});
