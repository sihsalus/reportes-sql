/**
 * Integration tests for the indicadores router with mocked Sequelize models.
 * Covers spec scenarios: create, update, versioning, SQL preview, not-found, conflict.
 *
 * Uses jest.mock directly — ts-jest handles hoisting for both CJS and ESM output.
 */

// ── Mock factories (before any imports — jest.mock is hoisted) ──────────

const mockIndicadorCreate = jest.fn();
const mockIndicadorFindByPk = jest.fn();
const mockIndicadorFindAndCountAll = jest.fn();
const mockIndicadorUpdate = jest.fn();
const mockIndicadorFindAll = jest.fn();
const mockVersionCreate = jest.fn();
const mockVersionFindOne = jest.fn();
const mockVersionFindAll = jest.fn();
const mockVersionMax = jest.fn();

jest.mock("../src/models/indicador.js", () => ({
  Indicador: Object.assign(
    (...args: unknown[]) => mockIndicadorCreate(...args),
    {
      create: (...args: unknown[]) => mockIndicadorCreate(...args),
      findByPk: (...args: unknown[]) => mockIndicadorFindByPk(...args),
      findAndCountAll: (...args: unknown[]) =>
        mockIndicadorFindAndCountAll(...args),
      findAll: (...args: unknown[]) => mockIndicadorFindAll(...args),
    },
  ),
  IndicadorVersion: Object.assign(
    (...args: unknown[]) => mockVersionCreate(...args),
    {
      create: (...args: unknown[]) => mockVersionCreate(...args),
      findOne: (...args: unknown[]) => mockVersionFindOne(...args),
      findAll: (...args: unknown[]) => mockVersionFindAll(...args),
      max: (...args: unknown[]) => mockVersionMax(...args),
    },
  ),
  IndicadorResultado: {},
}));

jest.mock("../src/validators/openmrs.js", () => ({
  validarDefinicionLocationUuids: jest.fn().mockResolvedValue([]),
  resolveConceptMap: jest.fn().mockResolvedValue({}),
  validarLocations: jest.fn().mockResolvedValue([]),
}));

import { jest } from "@jest/globals";
import express from "express";
import type { Request, Response } from "express";
import supertest from "supertest";
import { indicadoresRouter } from "../src/routers/indicadores.js";

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use("/indicadores", indicadoresRouter);
  app.use(
    (
      err: unknown,
      _req: Request,
      res: Response,
      _next: express.NextFunction,
    ) => {
      console.error("Test app error:", err);
      res.status(500).json({ detail: "Error interno del servidor" });
    },
  );
  return app;
}

const UUID = "00000000-0000-0000-0000-000000000001";
const UUID2 = "00000000-0000-0000-0000-000000000002";
const VERSION_UUID = "00000000-0000-0000-aaaa-000000000001";

function makeIndicadorRow(overrides: Record<string, unknown> = {}) {
  return {
    id: UUID,
    nombre: "Test Indicador",
    descripcion: "Test description",
    activo: true,
    creado_en: new Date("2026-01-01"),
    toJSON() {
      const { toJSON: _, update: __, save: ___, ...rest } = this as Record<string, unknown>;
      return rest;
    },
    update: mockIndicadorUpdate.mockResolvedValue(undefined),
    save: jest.fn(),
    ...overrides,
  };
}

function makeVersionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: VERSION_UUID,
    indicador_id: UUID,
    version: 1,
    definicion: {
      tipo: "conteo_atenciones",
      evento: { location_uuids: ["uuid-loc"] },
    },
    creado_en: new Date("2026-01-01"),
    toJSON() {
      const { toJSON: _, ...rest } = this as Record<string, unknown>;
      return rest;
    },
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("Indicadores Router", () => {
  describe("POST /indicadores — create", () => {
    test("creates indicator with version 1 and returns 201", async () => {
      const row = makeIndicadorRow();
      mockIndicadorCreate.mockResolvedValue(row);
      mockIndicadorFindByPk.mockResolvedValue(row);
      mockVersionCreate.mockResolvedValue(makeVersionRow());

      const app = createTestApp();
      const res = await supertest(app)
        .post("/indicadores")
        .send({
          nombre: "Test",
          definicion: {
            tipo: "conteo_atenciones",
          },
        });

      expect(res.status).toBe(201);
      expect(mockIndicadorCreate).toHaveBeenCalledTimes(1);
      expect(mockVersionCreate).toHaveBeenCalledTimes(1);
    });

    test("rejects missing nombre with 422", async () => {
      const app = createTestApp();
      const res = await supertest(app)
        .post("/indicadores")
        .send({ definicion: { tipo: "conteo_atenciones" } });

      expect(res.status).toBe(422);
    });

    test("rejects missing definicion with 422", async () => {
      const app = createTestApp();
      const res = await supertest(app)
        .post("/indicadores")
        .send({ nombre: "Test" });

      expect(res.status).toBe(422);
    });

    test("rejects invalid definicion with 422", async () => {
      const app = createTestApp();
      const res = await supertest(app)
        .post("/indicadores")
        .send({
          nombre: "Test",
          definicion: { tipo: "invalido" },
        });

      expect(res.status).toBe(422);
    });

    test("rejects definicion with periodo field (breaking contract)", async () => {
      const app = createTestApp();
      const res = await supertest(app)
        .post("/indicadores")
        .send({
          nombre: "Test",
          definicion: {
            tipo: "conteo_atenciones",
            periodo: "mes_actual",
          },
        });

      expect(res.status).toBe(422);
      expect(res.body.detail.field).toContain("periodo");
    });
  });

  describe("GET /indicadores — list", () => {
    test("returns paginated list", async () => {
      mockIndicadorFindAndCountAll.mockResolvedValue({
        count: 1,
        rows: [makeIndicadorRow()],
      });

      const app = createTestApp();
      const res = await supertest(app).get("/indicadores");

      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(1);
      expect(res.body.total).toBe(1);
    });
  });

  describe("GET /indicadores/:id — detail", () => {
    test("returns indicator with versions", async () => {
      mockIndicadorFindByPk.mockResolvedValue(makeIndicadorRow());
      mockVersionFindAll.mockResolvedValue([makeVersionRow()]);

      const app = createTestApp();
      const res = await supertest(app).get(`/indicadores/${UUID}`);

      expect(res.status).toBe(200);
      expect(res.body.versiones).toHaveLength(1);
    });

    test("returns 404 for unknown indicator", async () => {
      mockIndicadorFindByPk.mockResolvedValue(null);

      const app = createTestApp();
      const res = await supertest(app).get(`/indicadores/${UUID}`);

      expect(res.status).toBe(404);
    });
  });

  describe("PUT /indicadores/:id — update", () => {
    test("updates metadata without definicion", async () => {
      const row = makeIndicadorRow();
      mockIndicadorFindByPk.mockResolvedValue(row);

      const app = createTestApp();
      const res = await supertest(app)
        .put(`/indicadores/${UUID}`)
        .send({ nombre: "Updated" });

      expect(res.status).toBe(200);
      expect(mockIndicadorUpdate).toHaveBeenCalled();
      expect(mockVersionCreate).not.toHaveBeenCalled();
    });

    test("auto-creates version when definicion differs", async () => {
      mockIndicadorFindByPk.mockResolvedValue(makeIndicadorRow());
      mockVersionFindOne.mockResolvedValue(makeVersionRow());
      mockVersionMax.mockResolvedValue(1);
      mockVersionCreate.mockResolvedValue(makeVersionRow({ version: 2 }));

      const app = createTestApp();
      const res = await supertest(app)
        .put(`/indicadores/${UUID}`)
        .send({
          nombre: "Updated",
          definicion: {
            tipo: "conteo_pacientes",
          },
        });

      expect(res.status).toBe(200);
      expect(mockVersionCreate).toHaveBeenCalledTimes(1);
    });

    test("skips version when definicion unchanged", async () => {
      mockIndicadorFindByPk.mockResolvedValue(makeIndicadorRow());
      mockVersionFindOne.mockResolvedValue(
        makeVersionRow({
          definicion: {
            tipo: "conteo_atenciones",
          },
        }),
      );

      const app = createTestApp();
      const res = await supertest(app)
        .put(`/indicadores/${UUID}`)
        .send({
          nombre: "Updated",
          definicion: {
            tipo: "conteo_atenciones",
          },
        });

      expect(res.status).toBe(200);
      expect(mockVersionCreate).not.toHaveBeenCalled();
    });

    test("rejects definicion with periodo field", async () => {
      mockIndicadorFindByPk.mockResolvedValue(makeIndicadorRow());

      const app = createTestApp();
      const res = await supertest(app)
        .put(`/indicadores/${UUID}`)
        .send({
          nombre: "Test",
          definicion: {
            tipo: "conteo_atenciones",
            periodo: "mes_actual",
          },
        });

      expect(res.status).toBe(422);
      expect(res.body.detail.field).toContain("periodo");
      expect(mockVersionCreate).not.toHaveBeenCalled();
    });

    test("returns 404 for unknown indicator", async () => {
      mockIndicadorFindByPk.mockResolvedValue(null);

      const app = createTestApp();
      const res = await supertest(app)
        .put(`/indicadores/${UUID}`)
        .send({ nombre: "Updated" });

      expect(res.status).toBe(404);
    });
  });

  describe("DELETE /indicadores/:id — soft delete", () => {
    test("soft-deletes and returns 204", async () => {
      mockIndicadorFindByPk.mockResolvedValue(makeIndicadorRow());

      const app = createTestApp();
      const res = await supertest(app).delete(`/indicadores/${UUID}`);

      expect(res.status).toBe(204);
    });

    test("returns 404 for unknown", async () => {
      mockIndicadorFindByPk.mockResolvedValue(null);

      const app = createTestApp();
      const res = await supertest(app).delete(`/indicadores/${UUID}`);

      expect(res.status).toBe(404);
    });
  });

  describe("POST /indicadores/:id/versiones — create version", () => {
    test("creates new version and returns 201", async () => {
      mockIndicadorFindByPk.mockResolvedValue(makeIndicadorRow());
      mockVersionMax.mockResolvedValue(2);
      mockVersionCreate.mockResolvedValue(
        makeVersionRow({ version: 3, id: UUID2 }),
      );

      const app = createTestApp();
      const res = await supertest(app)
        .post(`/indicadores/${UUID}/versiones`)
        .send({
          definicion: {
            tipo: "conteo_pacientes",
          },
        });

      expect(res.status).toBe(201);
      expect(res.body.version).toBe(3);
    });

    test("returns 404 for unknown indicator", async () => {
      mockIndicadorFindByPk.mockResolvedValue(null);

      const app = createTestApp();
      const res = await supertest(app)
        .post(`/indicadores/${UUID}/versiones`)
        .send({
          definicion: {
            tipo: "conteo_atenciones",
          },
        });

      expect(res.status).toBe(404);
    });

    test("rejects versione with periodo field", async () => {
      mockIndicadorFindByPk.mockResolvedValue(makeIndicadorRow());

      const app = createTestApp();
      const res = await supertest(app)
        .post(`/indicadores/${UUID}/versiones`)
        .send({
          definicion: {
            tipo: "conteo_atenciones",
            periodo: "anual_actual",
          },
        });

      expect(res.status).toBe(422);
      expect(res.body.detail.field).toContain("periodo");
    });
  });

  describe("GET /indicadores/:id/preview-sql — SQL preview", () => {
    test("returns SQL preview for latest version (no version param)", async () => {
      mockIndicadorFindByPk.mockResolvedValue(makeIndicadorRow());
      mockVersionFindOne.mockResolvedValue(makeVersionRow());

      const app = createTestApp();
      const res = await supertest(app).get(
        `/indicadores/${UUID}/preview-sql`,
      );

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("sql");
      expect(res.body).toHaveProperty("params");
      expect(res.body.sql).toContain(":");
    });

    test("accepts version_id (snake_case) and returns preview", async () => {
      mockIndicadorFindByPk.mockResolvedValue(makeIndicadorRow());
      mockVersionFindOne.mockResolvedValue(makeVersionRow());

      const app = createTestApp();
      const res = await supertest(app).get(
        `/indicadores/${UUID}/preview-sql?version_id=${VERSION_UUID}`,
      );

      expect(res.status).toBe(200);
      expect(res.body.version_id).toBe(VERSION_UUID);
    });

    test("accepts versionId (camelCase) and returns preview", async () => {
      mockIndicadorFindByPk.mockResolvedValue(makeIndicadorRow());
      mockVersionFindOne.mockResolvedValue(makeVersionRow());

      const app = createTestApp();
      const res = await supertest(app).get(
        `/indicadores/${UUID}/preview-sql?versionId=${VERSION_UUID}`,
      );

      expect(res.status).toBe(200);
      expect(res.body.version_id).toBe(VERSION_UUID);
    });

    test("versionId takes precedence when both params are present", async () => {
      mockIndicadorFindByPk.mockResolvedValue(makeIndicadorRow());
      // versionFindOne is called with the resolved versionId;
      // verify it received the camelCase value (UUID2), not the snake_case (VERSION_UUID)
      mockVersionFindOne.mockImplementation(async ({ where }: any) => {
        return where.id === UUID2
          ? makeVersionRow({ id: UUID2, version: 2 })
          : null;
      });

      const app = createTestApp();
      const res = await supertest(app).get(
        `/indicadores/${UUID}/preview-sql?versionId=${UUID2}&version_id=${VERSION_UUID}`,
      );

      expect(res.status).toBe(200);
      expect(res.body.version_id).toBe(UUID2);
      expect(res.body.version_num).toBe(2);
    });

    test("returns 404 when version not found", async () => {
      mockIndicadorFindByPk.mockResolvedValue(makeIndicadorRow());
      mockVersionFindOne.mockResolvedValue(null);

      const app = createTestApp();
      const res = await supertest(app).get(
        `/indicadores/${UUID}/preview-sql?version_id=wrong-uuid`,
      );

      expect(res.status).toBe(404);
    });
  });
});
