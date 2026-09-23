/**
 * Integration tests for the metas router with mocked Sequelize models.
 * Covers spec scenarios for PUT, GET, and DELETE /metas.
 */

import { jest } from "@jest/globals";

// ── Mock factories (before any imports — jest.mock is hoisted) ──────────

const mockVersionFindOne = jest.fn();
const mockMetaFindOne = jest.fn();
const mockMetaDestroy = jest.fn();
const mockSequelizeQuery = jest.fn();

jest.mock("../src/database/postgres.js", () => ({
  sequelize: {
    query: (...args: unknown[]) => mockSequelizeQuery(...args),
  },
}));

jest.mock("../src/models/indicador.js", () => ({
  IndicadorVersion: {
    findOne: (...args: unknown[]) => mockVersionFindOne(...args),
  },
  IndicadorMeta: {
    findOne: (...args: unknown[]) => mockMetaFindOne(...args),
    destroy: (...args: unknown[]) => mockMetaDestroy(...args),
  },
}));

// Configured write privilege so the real requirePrivilege guard passes.
jest.mock("../src/config/index.js", () => ({
  settings: {
    openmrs_api_url: "http://fake-openmrs/openmrs",
    openmrs_api_user: "admin",
    openmrs_api_password: "test",
    openmrs_required_privilege: "app:indicadores:write",
    indicadores_db_host: "localhost",
    indicadores_db_port: 5432,
    indicadores_db_name: "test",
    indicadores_db_user: "test",
    indicadores_db_password: "test",
    openmrs_db_host: "localhost",
    openmrs_db_port: 3306,
    openmrs_db_name: "test",
    openmrs_db_user: "test",
    openmrs_db_password: "test",
    port: 8000,
    cors_origins: [],
    base_path: "",
    auto_register_catalog: false,
  },
  getIndicadoresDatabaseUrl: () =>
    "postgres://test:test@localhost:5432/test",
}));

import express from "express";
import supertest from "supertest";
import { metasRouter } from "../src/routers/metas.js";

// Simulates the requireSession middleware: an authenticated user holding the
// configured write privilege.
function stubAuthenticatedSession(
  req: express.Request,
  _res: express.Response,
  next: express.NextFunction,
) {
  (req as express.Request & { authUser?: unknown }).authUser = {
    uuid: "user-uuid-1",
    privileges: [{ display: "app:indicadores:write" }],
  };
  next();
}

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use(stubAuthenticatedSession);
  app.use("/metas", metasRouter);
  return app;
}

const VERSION_UUID = "00000000-0000-0000-aaaa-000000000001";
const INDICADOR_UUID = "00000000-0000-0000-0000-000000000001";
const META_UUID = "00000000-0000-0000-bbbb-000000000001";

const INDICADOR_NOMBRE = "Mortalidad materna";
const VERSION_NUMERO = 3;

function makeMetaRow(overrides: Record<string, unknown> = {}) {
  return {
    id: META_UUID,
    indicador_version_id: VERSION_UUID,
    anio: 2025,
    valor_meta: 1500,
    creado_en: new Date("2026-01-01"),
    indicador_nombre: INDICADOR_NOMBRE,
    version_numero: VERSION_NUMERO,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("Metas Router", () => {
  describe("PUT /metas — upsert", () => {
    test("SC-01: creates a new meta and returns 200 with full body", async () => {
      mockVersionFindOne.mockResolvedValue({ id: VERSION_UUID });
      mockSequelizeQuery.mockResolvedValue([
        {
          id: META_UUID,
          indicador_version_id: VERSION_UUID,
          anio: 2025,
          valor_meta: 1500,
          creado_en: new Date("2026-01-01"),
        },
      ]);

      const app = createTestApp();
      const res = await supertest(app).put("/metas").send({
        indicador_version_id: VERSION_UUID,
        anio: 2025,
        valor_meta: 1500,
      });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        id: META_UUID,
        indicador_version_id: VERSION_UUID,
        anio: 2025,
        valor_meta: 1500,
      });
      expect(res.body).toHaveProperty("creado_en");
      expect(mockSequelizeQuery).toHaveBeenCalledTimes(1);
    });

    test("SC-02: upserts existing meta and returns updated valor_meta", async () => {
      mockVersionFindOne.mockResolvedValue({ id: VERSION_UUID });
      mockSequelizeQuery.mockResolvedValue([
        {
          id: META_UUID,
          indicador_version_id: VERSION_UUID,
          anio: 2025,
          valor_meta: 2000,
          creado_en: new Date("2026-01-02"),
        },
      ]);

      const app = createTestApp();
      const res = await supertest(app).put("/metas").send({
        indicador_version_id: VERSION_UUID,
        anio: 2025,
        valor_meta: 2000,
      });

      expect(res.status).toBe(200);
      expect(res.body.valor_meta).toBe(2000);
    });

    test("SC-09: returns 422 when indicador_version_id does not exist", async () => {
      mockVersionFindOne.mockResolvedValue(null);

      const app = createTestApp();
      const res = await supertest(app).put("/metas").send({
        indicador_version_id: VERSION_UUID,
        anio: 2025,
        valor_meta: 100,
      });

      expect(res.status).toBe(422);
      expect(res.body.detail.message).toMatch(/indicador_version_id no encontrado/);
    });

    test("SC-10: returns 422 when anio is out of range", async () => {
      const app = createTestApp();

      const resLow = await supertest(app).put("/metas").send({
        indicador_version_id: VERSION_UUID,
        anio: 1999,
        valor_meta: 100,
      });
      expect(resLow.status).toBe(422);
      expect(resLow.body.detail.field).toBe("anio");

      const resHigh = await supertest(app).put("/metas").send({
        indicador_version_id: VERSION_UUID,
        anio: 2101,
        valor_meta: 100,
      });
      expect(resHigh.status).toBe(422);
      expect(resHigh.body.detail.field).toBe("anio");
    });

    test("SC-11: returns 422 when valor_meta is negative", async () => {
      const app = createTestApp();
      const res = await supertest(app).put("/metas").send({
        indicador_version_id: VERSION_UUID,
        anio: 2025,
        valor_meta: -1,
      });

      expect(res.status).toBe(422);
      expect(res.body.detail.field).toBe("valor_meta");
    });
  });

  describe("GET /metas — fetch", () => {
    test("SC-03: returns meta by indicador_version_id + anio", async () => {
      mockSequelizeQuery.mockResolvedValue([makeMetaRow()]);

      const app = createTestApp();
      const res = await supertest(app).get(
        `/metas?indicador_version_id=${VERSION_UUID}&anio=2025`,
      );

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        id: META_UUID,
        indicador_version_id: VERSION_UUID,
        anio: 2025,
        valor_meta: 1500,
        indicador_nombre: INDICADOR_NOMBRE,
        version_numero: VERSION_NUMERO,
      });
      expect(mockSequelizeQuery).toHaveBeenCalledTimes(1);
    });

    test("SC-04: returns meta by indicador_id + anio resolving latest version", async () => {
      // First call: resolve latest version; second call: fetch meta with JOINs
      mockSequelizeQuery
        .mockResolvedValueOnce([{ id: VERSION_UUID }])
        .mockResolvedValueOnce([makeMetaRow()]);

      const app = createTestApp();
      const res = await supertest(app).get(
        `/metas?indicador_id=${INDICADOR_UUID}&anio=2025`,
      );

      expect(res.status).toBe(200);
      expect(res.body.indicador_version_id).toBe(VERSION_UUID);
      expect(res.body.valor_meta).toBe(1500);
      expect(res.body.indicador_nombre).toBe(INDICADOR_NOMBRE);
      expect(res.body.version_numero).toBe(VERSION_NUMERO);
      expect(mockSequelizeQuery).toHaveBeenCalledTimes(2);
    });

    test("SC-14: returns 404 when meta not found by version", async () => {
      mockSequelizeQuery.mockResolvedValue([]);

      const app = createTestApp();
      const res = await supertest(app).get(
        `/metas?indicador_version_id=${VERSION_UUID}&anio=2025`,
      );

      expect(res.status).toBe(404);
      expect(res.body.detail.message).toMatch(/Meta no encontrada/);
    });

    test("SC-12: returns 422 when both indicador_version_id and indicador_id are provided", async () => {
      const app = createTestApp();
      const res = await supertest(app).get(
        `/metas?indicador_version_id=${VERSION_UUID}&indicador_id=${INDICADOR_UUID}&anio=2025`,
      );

      expect(res.status).toBe(422);
      expect(res.body.detail.message).toMatch(/Solo uno de/);
    });

    test("returns 422 when neither indicador_version_id nor indicador_id is provided", async () => {
      const app = createTestApp();
      const res = await supertest(app).get(`/metas?anio=2025`);

      expect(res.status).toBe(422);
      expect(res.body.detail.message).toMatch(/Se requiere/);
    });

    test("returns 404 when indicador_id has no active versions", async () => {
      mockSequelizeQuery.mockResolvedValue([]);

      const app = createTestApp();
      const res = await supertest(app).get(
        `/metas?indicador_id=${INDICADOR_UUID}&anio=2025`,
      );

      expect(res.status).toBe(404);
    });
  });

  describe("DELETE /metas — remove", () => {
    test("SC-05: deletes existing meta and returns 204", async () => {
      mockMetaDestroy.mockResolvedValue(1);

      const app = createTestApp();
      const res = await supertest(app).delete(
        `/metas?indicador_version_id=${VERSION_UUID}&anio=2025`,
      );

      expect(res.status).toBe(204);
      expect(mockMetaDestroy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { indicador_version_id: VERSION_UUID, anio: 2025 },
        }),
      );
    });

    test("SC-13: returns 404 when deleting non-existent meta", async () => {
      mockMetaDestroy.mockResolvedValue(0);

      const app = createTestApp();
      const res = await supertest(app).delete(
        `/metas?indicador_version_id=${VERSION_UUID}&anio=2025`,
      );

      expect(res.status).toBe(404);
      expect(res.body.detail.message).toMatch(/Meta no encontrada/);
    });
  });
});
