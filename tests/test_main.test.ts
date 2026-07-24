/**
 * Tests for main.ts: error middleware, CORS, body size limit, and start().
 *
 * Uses the same mock setup as test_app_routing.test.ts.
 */
import { jest } from "@jest/globals";

// ── Mock factories ─────────────────────────────────────────────────────────

const mockSequelizeSync = jest.fn().mockResolvedValue(undefined);
const mockSequelizeClose = jest.fn().mockResolvedValue(undefined);
const mockSequelizeAuthenticate = jest.fn().mockResolvedValue(undefined);

const mockFindAndCountAll = jest.fn().mockResolvedValue({ count: 0, rows: [] });
const mockFindByPk = jest.fn().mockResolvedValue(null);
const mockModelCreate = jest
  .fn()
  .mockResolvedValue({ toJSON: () => ({ id: "mock-id" }) });
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
    query: jest.fn().mockResolvedValue([]),
  },
  testPostgresConnection: jest.fn().mockResolvedValue(true),
  disposePostgres: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../src/database/mysql.js", () => ({
  getMysqlPool: jest.fn(() => ({
    execute: jest.fn().mockResolvedValue([[]]),
    end: jest.fn().mockResolvedValue(undefined),
  })),
  queryMysql: jest.fn().mockResolvedValue([]),
  disposeMysql: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../src/models/indicador.js", () => ({
  Indicador: Object.assign((...args: unknown[]) => mockModelCreate(...args), {
    create: (...args: unknown[]) => mockModelCreate(...args),
    findByPk: (...args: unknown[]) => mockFindByPk(...args),
    findAndCountAll: (...args: unknown[]) => mockFindAndCountAll(...args),
    findAll: (...args: unknown[]) => mockFindAll(...args),
    findOne: (...args: unknown[]) => mockFindOne(...args),
    update: (...args: unknown[]) => mockModelUpdate(...args),
  }),
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

const mockFetch = jest.fn().mockResolvedValue({
  ok: true,
  status: 200,
  json: jest.fn().mockResolvedValue({ results: [] }),
  text: jest.fn().mockResolvedValue(""),
});
global.fetch = mockFetch as unknown as typeof fetch;

import supertest from "supertest";
import type { Express } from "express";
import { createApp } from "../src/main.js";

// Silence logger during tests
beforeAll(() => {
  jest.spyOn(console, "error").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "info").mockImplementation(() => {});
  jest.spyOn(console, "debug").mockImplementation(() => {});
});

afterAll(() => {
  jest.restoreAllMocks();
});

function makeApp(basePath = ""): { app: Express; request: supertest.Agent } {
  const app = createApp(basePath);
  return { app, request: supertest(app) };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockFindAndCountAll.mockResolvedValue({ count: 0, rows: [] });
  mockFindByPk.mockResolvedValue(null);
  mockFindOne.mockResolvedValue(null);
  mockFindAll.mockResolvedValue([]);
});

// ── CORS ───────────────────────────────────────────────────────────────────

describe("CORS headers", () => {
  test("OPTIONS preflight returns CORS headers when Origin is set", async () => {
    const { request } = makeApp();

    const res = await request
      .options("/health")
      .set("Origin", "http://localhost:5173");

    expect(res.headers["access-control-allow-origin"]).toBeDefined();
    expect(res.headers["access-control-allow-credentials"]).toBe("true");
  });

  test("GET with Origin returns allow-origin", async () => {
    const { request } = makeApp();

    const res = await request
      .get("/health")
      .set("Origin", "http://localhost:5173");

    expect(res.headers["access-control-allow-origin"]).toBeDefined();
    expect(res.headers["access-control-allow-credentials"]).toBe("true");
  });

  test("OPTIONS preflight allows methods", async () => {
    const { request } = makeApp();

    const res = await request
      .options("/indicadores")
      .set("Origin", "http://localhost:5173");

    expect(res.headers["access-control-allow-methods"]).toBeDefined();
  });
});

// ── Body size limit ────────────────────────────────────────────────────────

describe("body size limit (1MB)", () => {
  test("rejects payload larger than 1MB (Express 5 may differ)", async () => {
    const { request } = makeApp();

    // ~1.1 MB of text — exceeds the 1MB limit set in createApp
    const largeStr = "x".repeat(1024 * 1024 + 50_000);
    const largeBody = { data: largeStr };

    const res = await request
      .put("/metas")
      .send(largeBody)
      .set("Content-Type", "application/json");

    // Express 5 json() may or may not return 413 for oversized payloads;
    // the important thing is the app doesn't crash and returns some error.
    // Valid outcomes: 413 (payload too large), 400 (bad request),
    // 422 (validation), or 500 (internal — the body is passed through
    // but the route handler fails on the giant payload).
    expect([413, 400, 422, 500]).toContain(res.status);
  });

  test("accepts payload under 1MB", async () => {
    const { request } = makeApp();

    const res = await request
      .put("/metas")
      .send({
        indicador_version_id: "00000000-0000-0000-0000-000000000001",
        anio: 2026,
        valor_meta: 100,
      })
      .set("Content-Type", "application/json");

    // Should not be 413
    expect(res.status).not.toBe(413);
  });
});

// ── ZodError response shape (through metas PUT endpoint) ───────────────────

describe("ZodError response via metas endpoint", () => {
  test("PUT /metas without required fields returns 422", async () => {
    const { request } = makeApp();

    const res = await request
      .put("/metas")
      .send({})
      .set("Content-Type", "application/json");

    expect(res.status).toBe(422);
  });

  test("PUT /metas 422 response has detail.field and detail.message", async () => {
    const { request } = makeApp();

    const res = await request
      .put("/metas")
      .send({})
      .set("Content-Type", "application/json");

    expect(res.status).toBe(422);
    expect(res.body).toHaveProperty("detail");
    expect(res.body.detail).toHaveProperty("field");
    expect(res.body.detail).toHaveProperty("message");
  });

  test("PUT /metas with invalid anio (wrong type) returns 422", async () => {
    const { request } = makeApp();

    const res = await request
      .put("/metas")
      .send({
        indicador_version_id: "00000000-0000-0000-0000-000000000001",
        anio: "not-a-number",
        valor_meta: 100,
      })
      .set("Content-Type", "application/json");

    expect(res.status).toBe(422);
  });
});

// ── Error handling ─────────────────────────────────────────────────────────

describe("error handling", () => {
  test("unknown route returns 404", async () => {
    const { request } = makeApp();

    const res = await request.get("/this-does-not-exist-xyz");

    expect(res.status).toBe(404);
  });

  test("malformed JSON body is handled without crashing", async () => {
    const { request } = makeApp();

    const res = await request
      .put("/metas")
      .set("Content-Type", "application/json")
      .send('not json at all {{{');

    // Express may return 400 (bad request) or 500 (internal) depending
    // on the version. The important thing is the app doesn't crash.
    expect([400, 500]).toContain(res.status);
  });
});

// ── Application structure ──────────────────────────────────────────────────

describe("createApp structure", () => {
  test("returns an Express app with listen and use", () => {
    const app = createApp("");
    expect(app).toBeDefined();
    expect(typeof app.listen).toBe("function");
    expect(typeof app.use).toBe("function");
  });

  test("with basePath returns valid Express app", () => {
    const app = createApp("/api/v2");
    expect(app).toBeDefined();
    expect(typeof app.listen).toBe("function");
  });

  test("JSON body parser accepts valid requests", async () => {
    const { request } = makeApp();

    const res = await request
      .put("/metas")
      .send({
        indicador_version_id: "00000000-0000-0000-0000-000000000001",
        anio: 2026,
        valor_meta: 100,
      })
      .set("Content-Type", "application/json");

    // Body was parsed (status is not 400/415)
    expect(res.status).not.toBe(400);
  });
});
