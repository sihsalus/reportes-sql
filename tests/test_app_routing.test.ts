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
  queryMysql: jest.fn().mockResolvedValue([]),
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
  validarDefinicionEncounterTypeUuids: jest.fn().mockResolvedValue([]),
  validarDefinicionDiagnosticoUuids: jest.fn().mockResolvedValue([]),
  resolveConceptMap: jest.fn().mockResolvedValue({}),
  validarLocations: jest.fn().mockResolvedValue([]),
}));

// Mock global fetch: /ws/rest/v1/session returns an authenticated session
// (for requireSession); every other OpenMRS call (conceptos proxy) returns
// an empty results list.
//
// The default session user is a regular clinician (no super-user role) so the
// write guard stays fail-closed. Tests that need an administrator swap in
// SUPER_SESSION_USER via `currentSessionUser`.
type MockSessionUser = {
  uuid: string;
  display: string;
  roles: Array<{ display: string; uuid: string }>;
  privileges: Array<{ display: string; uuid: string }>;
};

const NORMAL_SESSION_USER: MockSessionUser = {
  uuid: "user-uuid-1",
  display: "Test User",
  roles: [{ display: "Provider", uuid: "role-uuid-1" }],
  privileges: [{ display: "app:indicadores", uuid: "priv-uuid-0" }],
};

const SUPER_SESSION_USER: MockSessionUser = {
  uuid: "user-uuid-1",
  display: "Admin User",
  roles: [{ display: "System Developer", uuid: "role-uuid-1" }],
  privileges: [{ display: "app:indicadores", uuid: "priv-uuid-0" }],
};

let currentSessionUser: MockSessionUser = NORMAL_SESSION_USER;

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
      json: async () => ({ authenticated: true, user: currentSessionUser }),
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

import { jest } from "@jest/globals";
import supertest from "supertest";
import type { Express } from "express";
import { createApp } from "../src/main.js";
import { normalizeBasePath } from "../src/config/index.js";
import { queryMysql } from "../src/database/mysql.js";
import { testPostgresConnection } from "../src/database/postgres.js";

// ── Helpers ────────────────────────────────────────────────────────────

function requestFor(basePath: string) {
  const app: Express = createApp(normalizeBasePath(basePath));
  return { app, request: supertest(app) };
}

// /health is a readiness probe: it reports each data store. The database
// modules are mocked above as reachable, so every probe returns "ok".
const HEALTHY_BODY = {
  status: "ok",
  checks: { postgres: "ok", openmrs_mysql: "ok" },
};

beforeEach(() => {
  jest.clearAllMocks();
  currentSessionUser = NORMAL_SESSION_USER;
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
    expect(res.body).toEqual(HEALTHY_BODY);
  });

  it("serves /indicadores at root", async () => {
    const res = await request
      .get("/indicadores")
      .set("Cookie", "JSESSIONID=test-session");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("items");
    expect(res.body).toHaveProperty("total");
  });

  it("serves /resultados at root", async () => {
    const res = await request
      .get("/resultados")
      .set("Cookie", "JSESSIONID=test-session");
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

  it("returns 404 for unknown route when authenticated", async () => {
    const res = await request
      .get("/nonexistent")
      .set("Cookie", "JSESSIONID=test-session");
    expect(res.status).toBe(404);
  });
});

// ── Readiness probe failure modes ───────────────────────────────────────

describe("/health readiness probe", () => {
  it("returns 503 when the OpenMRS MySQL database is unreachable", async () => {
    const { request } = requestFor("");
    jest.mocked(queryMysql).mockRejectedValueOnce(new Error("mysql down"));

    const res = await request.get("/health");

    expect(res.status).toBe(503);
    expect(res.body).toEqual({
      status: "error",
      checks: { postgres: "ok", openmrs_mysql: "error" },
    });
  });

  it("returns 503 when PostgreSQL is unreachable", async () => {
    const { request } = requestFor("");
    jest.mocked(testPostgresConnection).mockResolvedValueOnce(false);

    const res = await request.get("/health");

    expect(res.status).toBe(503);
    expect(res.body).toEqual({
      status: "error",
      checks: { postgres: "error", openmrs_mysql: "ok" },
    });
  });
});

// ── Prefixed routing (BASE_PATH set) ────────────────────────────────────

describe("prefixed routing — BASE_PATH=/openmrs/services/reportes-sql", () => {
  const prefix = "/openmrs/services/reportes-sql";
  const { request } = requestFor(prefix);

  it("serves /health at root (unprefixed gateway probe)", async () => {
    const res = await request.get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual(HEALTHY_BODY);
  });

  it("serves /health at prefixed path too", async () => {
    const res = await request.get(`${prefix}/health`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(HEALTHY_BODY);
  });

  it("serves /indicadores at prefixed path", async () => {
    const res = await request
      .get(`${prefix}/indicadores`)
      .set("Cookie", "JSESSIONID=test-session");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("items");
    expect(res.body).toHaveProperty("total");
  });

  it("serves /resultados at prefixed path", async () => {
    const res = await request
      .get(`${prefix}/resultados`)
      .set("Cookie", "JSESSIONID=test-session");
    expect(res.status).toBe(200);
  });

  it("serves /conceptos at prefixed path", async () => {
    // /conceptos/encounter-types uses fetch to OpenMRS (mocked)
    const res = await request
      .get(`${prefix}/conceptos/encounter-types`)
      .set("Cookie", "JSESSIONID=test-session");
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
    expect(res.body).toEqual(HEALTHY_BODY);
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
    const res = await request
      .get("/indicadores")
      .set("Cookie", "JSESSIONID=test-session");
    expect(res.status).toBe(200);
  });
});

// ── Incoming auth — requireSession gate ─────────────────────────────────

describe("incoming auth — requireSession gate", () => {
  const prefix = "/openmrs/services/reportes-sql";
  const session = ["Cookie", "JSESSIONID=test-session"] as const;

  it("returns 401 without a session on all four protected routers (root mount)", async () => {
    const { request } = requestFor("");

    for (const path of [
      "/indicadores",
      "/resultados",
      "/conceptos/encounter-types",
      "/metas",
    ]) {
      const res = await request.get(path);
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ detail: "No autorizado" });
    }
    // Missing cookie ⇒ no upstream validation call at all
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns 401 without a session on all four protected routers (prefixed mount)", async () => {
    const { request } = requestFor(prefix);

    for (const path of [
      `${prefix}/indicadores`,
      `${prefix}/resultados`,
      `${prefix}/conceptos/encounter-types`,
      `${prefix}/metas`,
    ]) {
      const res = await request.get(path);
      expect(res.status).toBe(401);
    }
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns 403 on all eight write/recalc handlers for a non-super user lacking the manage privilege", async () => {
    const { request } = requestFor("");
    const indicadorId = "00000000-0000-0000-0000-000000000001";

    const cases: Array<[string, string]> = [
      ["post", "/indicadores"],
      ["put", `/indicadores/${indicadorId}`],
      ["delete", `/indicadores/${indicadorId}`],
      ["post", `/indicadores/${indicadorId}/versiones`],
      ["post", "/resultados/calcular-ahora"],
      ["post", "/resultados/recalcular-anio"],
      ["put", "/metas"],
      ["delete", "/metas"],
    ];

    for (const [method, path] of cases) {
      const req = request[method as "post" | "put" | "delete"](path);
      const res = await req.set(...session);
      expect(res.status).toBe(403);
      expect(res.body).toEqual({ detail: "Sin privilegios" });
    }
  });

  it("lets a super user through the write guard even when the privilege is unset", async () => {
    currentSessionUser = SUPER_SESSION_USER;
    const { request } = requestFor("");

    const res = await request.post("/indicadores").set(...session);

    // Passes requireManagePrivilege as a super user, then fails request validation
    // (422) — never the fail-closed 403.
    expect(res.status).not.toBe(403);
    expect(res.status).toBe(422);
  });

  it("keeps /health public at both mount positions (no cookie needed)", async () => {
    const { request } = requestFor(prefix);

    const rootRes = await request.get("/health");
    expect(rootRes.status).toBe(200);
    expect(rootRes.body).toEqual(HEALTHY_BODY);

    const prefixedRes = await request.get(`${prefix}/health`);
    expect(prefixedRes.status).toBe(200);
    expect(prefixedRes.body).toEqual(HEALTHY_BODY);

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("keeps /docs and /docs/openapi.json public (no cookie needed)", async () => {
    const { request } = requestFor("");

    const docsRes = await request.get("/docs/");
    expect(docsRes.status).toBe(200);

    const openapiRes = await request.get("/docs/openapi.json");
    expect(openapiRes.status).toBe(200);
    expect(openapiRes.body).toHaveProperty("openapi");

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("serves /docs/openapi.json at prefixed mount without a session", async () => {
    const { request } = requestFor(prefix);

    const res = await request.get(`${prefix}/docs/openapi.json`);
    expect(res.status).toBe(200);
    expect(res.body.servers[0].url).toBe(`http://localhost:8000${prefix}`);
  });
});

// ── Module access gate (app:indicadores) ────────────────────────────────

describe("incoming auth — module access gate (app:indicadores)", () => {
  const session = ["Cookie", "JSESSIONID=test-session"] as const;

  it("returns 403 on reads when the session lacks app:indicadores", async () => {
    currentSessionUser = {
      uuid: "user-uuid-1",
      display: "No Module Privilege",
      roles: [{ display: "Provider", uuid: "role-uuid-1" }],
      privileges: [],
    };
    const { request } = requestFor("");

    for (const path of [
      "/indicadores",
      "/resultados",
      "/metas",
      "/conceptos/encounter-types",
    ]) {
      const res = await request.get(path).set(...session);
      expect(res.status).toBe(403);
      expect(res.body).toEqual({ detail: "Sin privilegios" });
    }
  });

  it("serves a read when the session holds app:indicadores", async () => {
    const { request } = requestFor("");

    const res = await request.get("/indicadores").set(...session);
    expect(res.status).toBe(200);
  });

  it("keeps /health and /docs public at the module gate", async () => {
    const { request } = requestFor("");

    expect((await request.get("/health")).status).toBe(200);
    expect((await request.get("/docs/openapi.json")).status).toBe(200);
  });

  it("lets a non-super user holding the manage privilege through the write guard", async () => {
    currentSessionUser = {
      uuid: "user-uuid-1",
      display: "Manager",
      roles: [{ display: "Provider", uuid: "role-uuid-1" }],
      privileges: [
        { display: "app:indicadores", uuid: "priv-uuid-0" },
        { display: "app:indicadores.editar", uuid: "priv-uuid-1" },
      ],
    };
    const { request } = requestFor("");

    const res = await request.post("/indicadores").set(...session);

    // Passes the module + manage guards, then fails request validation (422).
    expect(res.status).not.toBe(403);
    expect(res.status).toBe(422);
  });
});
