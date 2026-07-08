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

import express from "express";
import supertest from "supertest";
import { metasRouter } from "../src/routers/metas.js";

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use("/metas", metasRouter);
  return app;
}

const VERSION_UUID = "00000000-0000-0000-aaaa-000000000001";
const INDICADOR_UUID = "00000000-0000-0000-0000-000000000001";
const META_UUID = "00000000-0000-0000-bbbb-000000000001";

function makeMetaRow(overrides: Record<string, unknown> = {}) {
  return {
    id: META_UUID,
    indicador_version_id: VERSION_UUID,
    anio: 2025,
    valor_meta: 1500,
    creado_en: new Date("2026-01-01"),
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
      expect(res.body.detail.message).toMatch(/indicador_version_id not found/);
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
      mockMetaFindOne.mockResolvedValue(makeMetaRow());

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
      });
      expect(mockMetaFindOne).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { indicador_version_id: VERSION_UUID, anio: 2025 },
        }),
      );
    });

    test("SC-04: returns meta by indicador_id + anio resolving latest version", async () => {
      mockSequelizeQuery.mockResolvedValue([{ id: VERSION_UUID }]);
      mockMetaFindOne.mockResolvedValue(makeMetaRow());

      const app = createTestApp();
      const res = await supertest(app).get(
        `/metas?indicador_id=${INDICADOR_UUID}&anio=2025`,
      );

      expect(res.status).toBe(200);
      expect(res.body.indicador_version_id).toBe(VERSION_UUID);
      expect(res.body.valor_meta).toBe(1500);
      expect(mockSequelizeQuery).toHaveBeenCalledTimes(1);
    });

    test("SC-14: returns 404 when meta not found by version", async () => {
      mockMetaFindOne.mockResolvedValue(null);

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
