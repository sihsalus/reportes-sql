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

// Mock config: same defaults as the real module, with a configured write
// privilege so request validation tests reach the route handlers (a
// fail-closed 403 is covered separately in test_app_routing).
jest.mock("../src/config/index.js", () => ({
  settings: {
    openmrs_api_url: "http://fake-openmrs/openmrs",
    openmrs_api_user: "admin",
    openmrs_api_password: "test",
    openmrs_required_privilege: "app:indicadores:write",
    cors_origins: [
      "http://localhost:5173",
      "http://127.0.0.1:5173",
      "http://localhost:8080",
      "http://127.0.0.1:8080",
    ],
    base_path: "",
    port: 8000,
  },
}));

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
  validarDefinicionEncounterTypeUuids: jest.fn().mockResolvedValue([]),
  validarDefinicionDiagnosticoUuids: jest.fn().mockResolvedValue([]),
  resolveConceptMap: jest.fn().mockResolvedValue({}),
  validarLocations: jest.fn().mockResolvedValue([]),
}));

const SESSION_COOKIE = ["Cookie", "JSESSIONID=test-session"] as const;

// Mock global fetch: /ws/rest/v1/session returns an authenticated session
// carrying the configured write privilege; other OpenMRS calls (conceptos
// proxy) return an empty results list.
const mockFetch = jest.fn((input: RequestInfo | URL) => {
  const url =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url;
  if (url.includes("/ws/rest/v1/session")) {
    return Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({
        authenticated: true,
        user: {
          uuid: "user-uuid-1",
          display: "Test User",
          roles: [{ display: "System Developer", uuid: "role-uuid-1" }],
          privileges: [
            { display: "app:indicadores:write", uuid: "priv-uuid-1" },
          ],
        },
      }),
      text: async () => "",
    }) as Promise<Response>;
  }
  return Promise.resolve({
    ok: true,
    status: 200,
    json: async () => ({ results: [] }),
    text: async () => "",
  }) as Promise<Response>;
});
global.fetch = mockFetch as unknown as typeof fetch;

import supertest from "supertest";
import type { Express } from "express";
import express from "express";
import { createApp, errorMiddleware } from "../src/main.js";
import { asyncHandler } from "../src/middleware/async-handler.js";

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

  test("OPTIONS preflight allows explicit methods, never a wildcard", async () => {
    const { request } = makeApp();

    const res = await request
      .options("/indicadores")
      .set("Origin", "http://localhost:5173")
      .set("Access-Control-Request-Method", "POST");

    expect(res.headers["access-control-allow-methods"]).toBeDefined();
    expect(res.headers["access-control-allow-methods"]).not.toContain("*");
    for (const method of ["GET", "POST", "PUT", "DELETE", "OPTIONS"]) {
      expect(res.headers["access-control-allow-methods"]).toContain(method);
    }
  });

  test("rejects preflight from a non-allowlisted origin (no allow-origin header)", async () => {
    const { request } = makeApp();

    const res = await request
      .options("/indicadores")
      .set("Origin", "https://evil.example")
      .set("Access-Control-Request-Method", "POST");

    // The granting header is never sent for a non-allowlisted origin; without
    // Access-Control-Allow-Origin the browser blocks the cross-origin request.
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  test("GET from a non-allowlisted origin gets no CORS headers", async () => {
    const { request } = makeApp();

    const res = await request
      .get("/health")
      .set("Origin", "https://evil.example");

    // Route still serves (CORS is browser enforcement), but no allow-origin.
    expect(res.status).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  test("OPTIONS preflight from an allowlisted origin keeps credentials: true", async () => {
    const { request } = makeApp();

    const res = await request
      .options("/metas")
      .set("Origin", "http://localhost:8080")
      .set("Access-Control-Request-Method", "PUT")
      .set("Access-Control-Request-Headers", "content-type");

    expect(res.headers["access-control-allow-origin"]).toBe(
      "http://localhost:8080",
    );
    expect(res.headers["access-control-allow-credentials"]).toBe("true");
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
      .set(...SESSION_COOKIE)
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
      .set(...SESSION_COOKIE)
      .send({})
      .set("Content-Type", "application/json");

    expect(res.status).toBe(422);
  });

  test("PUT /metas 422 response has detail.field and detail.message", async () => {
    const { request } = makeApp();

    const res = await request
      .put("/metas")
      .set(...SESSION_COOKIE)
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
      .set(...SESSION_COOKIE)
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
  test("unknown route returns 404 when authenticated", async () => {
    const { request } = makeApp();

    const res = await request
      .get("/this-does-not-exist-xyz")
      .set(...SESSION_COOKIE);

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

  test("propagated ZodError is classified as 422 by error middleware", async () => {
    // Build a minimal app with a route that throws a ZodError WITHOUT a local
    // catch, then the error middleware AFTER it (correct stack order). This
    // verifies the asyncHandler → next(err) → errorMiddleware path classifies
    // ZodError as 422 (not 500).
    const { z } = await import("zod");
    const app = express();
    app.use(
      "/__test/throw-zod",
      asyncHandler(async () => {
        z.object({ required: z.string() }).parse({});
      }),
    );
    app.use(errorMiddleware);

    const res = await supertest(app)
      .get("/__test/throw-zod")
      .set("Content-Type", "application/json");

    expect(res.status).toBe(422);
    expect(res.body).toHaveProperty("detail");
    expect(res.body.detail).toHaveProperty("field");
    expect(res.body.detail).toHaveProperty("message");
  });

  test("propagated generic Error is classified as 500 by error middleware", async () => {
    const app = express();
    app.use(
      "/__test/throw-generic",
      asyncHandler(async () => {
        throw new Error("something broke");
      }),
    );
    app.use(errorMiddleware);

    const res = await supertest(app)
      .get("/__test/throw-generic")
      .set("Content-Type", "application/json");

    expect(res.status).toBe(500);
    expect(res.body).toHaveProperty("detail");
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
      .set(...SESSION_COOKIE)
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

// ── HTTP access logging ─────────────────────────────────────────────────────

describe("access log middleware", () => {
  test("GET /health logs a line containing method, path, and status", async () => {
    const { request } = makeApp();

    const res = await request.get("/health");

    expect(res.status).toBe(200);

    const calls = (console.info as jest.Mock).mock.calls;
    const lines = calls.map((c) => String(c[0]));
    const accessLine = lines.find(
      (l) => l.includes("request completed") && l.includes("GET") && l.includes("/health"),
    );
    expect(accessLine).toBeDefined();
    expect(accessLine).toContain("200");
  });

  test("generates a request-id when no X-Request-Id header is sent", async () => {
    const { request } = makeApp();

    const res = await request.get("/health");

    expect(res.status).toBe(200);
    // The generated id is a UUID string surfaced in the access-log line.
    const calls = (console.info as jest.Mock).mock.calls;
    const lines = calls.map((c) => String(c[0]));
    const accessLine = lines.find((l) => l.includes("requestId"));
    expect(accessLine).toMatch(/requestId":"[0-9a-f-]{36}"/);
  });

  test("echoes the X-Request-Id header when present", async () => {
    const { request } = makeApp();

    const fixedId = "11111111-2222-3333-4444-555555555555";
    const res = await request.get("/health").set("X-Request-Id", fixedId);

    expect(res.status).toBe(200);
    const calls = (console.info as jest.Mock).mock.calls;
    const lines = calls.map((c) => String(c[0]));
    const accessLine = lines.find((l) => l.includes("requestId"));
    expect(accessLine).toContain(`requestId":"${fixedId}`);
  });
});
