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
const mockSequelizeQuery = jest.fn();

jest.mock("../src/database/postgres.js", () => ({
  sequelize: {
    query: (...args: unknown[]) => mockSequelizeQuery(...args),
  },
}));

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
  validarDefinicionEncounterTypeUuids: jest.fn().mockResolvedValue([]),
  validarDefinicionDiagnosticoUuids: jest.fn().mockResolvedValue([]),
  resolveConceptMap: jest.fn().mockResolvedValue({}),
  validarLocations: jest.fn().mockResolvedValue([]),
}));

// The stub user holds the fixed manage privilege so the real guard passes.
jest.mock("../src/config/index.js", () => ({
  settings: {
    openmrs_api_url: "http://fake-openmrs/openmrs",
    indicators_db_host: "localhost",
    indicators_db_port: 5432,
    indicators_db_name: "test",
    indicators_db_user: "test",
    indicators_db_password: "test",
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

import { jest } from "@jest/globals";
import express from "express";
import type { Request, Response } from "express";
import supertest from "supertest";
import { indicadoresRouter } from "../src/routers/indicadores.js";
import { metasRouter } from "../src/routers/metas.js";
import {
  validarDefinicionDiagnosticoUuids,
  validarDefinicionEncounterTypeUuids,
} from "../src/validators/openmrs.js";

// Simulates the requireSession middleware: an authenticated user holding the
// configured write privilege.
function stubAuthenticatedSession(
  req: Request,
  _res: Response,
  next: express.NextFunction,
) {
  (req as Request & { authUser?: unknown }).authUser = {
    uuid: "user-uuid-1",
    privileges: [{ display: "app:indicadores.editar" }],
  };
  next();
}

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use(stubAuthenticatedSession);
  app.use("/indicadores", indicadoresRouter);
  app.use("/metas", metasRouter);
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

const INDICADOR_ID = 1;
const NEW_VERSION_ID = 2;
const PREV_VERSION_ID = 11;

function makeIndicadorRow(overrides: Record<string, unknown> = {}) {
  return {
    id: INDICADOR_ID,
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
    id: PREV_VERSION_ID,
    indicador_id: INDICADOR_ID,
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

    test("missing nombre → 422 with exact message 'nombre es obligatorio y no puede estar vacío'", async () => {
      const app = createTestApp();
      const res = await supertest(app)
        .post("/indicadores")
        .send({ definicion: { tipo: "conteo_atenciones" } });

      expect(res.status).toBe(422);
      expect(res.body.detail.field).toBe("nombre");
      expect(res.body.detail.message).toBe(
        "nombre es obligatorio y no puede estar vacío",
      );
    });

    test("empty nombre string → 422 with exact message", async () => {
      const app = createTestApp();
      const res = await supertest(app)
        .post("/indicadores")
        .send({
          nombre: "   ",
          definicion: { tipo: "conteo_atenciones" },
        });

      expect(res.status).toBe(422);
      expect(res.body.detail.field).toBe("nombre");
      expect(res.body.detail.message).toBe(
        "nombre es obligatorio y no puede estar vacío",
      );
    });

    test("valid body passes through to the definicion step (missing definicion → 422)", async () => {
      const app = createTestApp();
      const res = await supertest(app)
        .post("/indicadores")
        .send({ nombre: "Test" });

      // nombre validation passes, falls through to 'definicion es obligatorio'
      expect(res.status).toBe(422);
      expect(res.body.detail.field).toBe("definicion");
      expect(res.body.detail.message).toBe("definicion es obligatorio");
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

    test("rejects unknown encounter_type_uuids with 422", async () => {
      (validarDefinicionEncounterTypeUuids as jest.Mock).mockResolvedValueOnce([
        "unknown-et-uuid",
      ]);
      const app = createTestApp();
      const res = await supertest(app)
        .post("/indicadores")
        .send({
          nombre: "Test",
          definicion: {
            tipo: "conteo_atenciones",
            evento: { encounter_type_uuids: ["unknown-et-uuid"] },
          },
        });

      expect(res.status).toBe(422);
      expect(res.body.detail.field).toBe("encounter_type_uuids");
      expect(res.body.detail.unknown_uuids).toEqual(["unknown-et-uuid"]);
      expect(mockIndicadorCreate).not.toHaveBeenCalled();
    });

    test("rejects unknown diagnostico uuids with 422", async () => {
      (validarDefinicionDiagnosticoUuids as jest.Mock).mockResolvedValueOnce([
        "unknown-diag-uuid",
      ]);
      const app = createTestApp();
      const res = await supertest(app)
        .post("/indicadores")
        .send({
          nombre: "Test",
          definicion: {
            tipo: "conteo_atenciones",
            evento: {
              diagnosticos: [{ concepto_uuids: ["unknown-diag-uuid"] }],
            },
          },
        });

      expect(res.status).toBe(422);
      expect(res.body.detail.field).toBe("diagnosticos");
      expect(res.body.detail.unknown_uuids).toEqual(["unknown-diag-uuid"]);
      expect(mockIndicadorCreate).not.toHaveBeenCalled();
    });

    test("returns 502 when encounter type validation hits an OpenMRS outage", async () => {
      (validarDefinicionEncounterTypeUuids as jest.Mock).mockRejectedValueOnce(
        new Error("OpenMRS no disponible"),
      );
      const app = createTestApp();
      const res = await supertest(app)
        .post("/indicadores")
        .send({
          nombre: "Test",
          definicion: {
            tipo: "conteo_atenciones",
            evento: { encounter_type_uuids: ["et-uuid"] },
          },
        });

      expect(res.status).toBe(502);
      expect(mockIndicadorCreate).not.toHaveBeenCalled();
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
      const res = await supertest(app).get(`/indicadores/${INDICADOR_ID}`);

      expect(res.status).toBe(200);
      expect(res.body.versiones).toHaveLength(1);
    });

    test("returns 404 for unknown indicator", async () => {
      mockIndicadorFindByPk.mockResolvedValue(null);

      const app = createTestApp();
      const res = await supertest(app).get(`/indicadores/${INDICADOR_ID}`);

      expect(res.status).toBe(404);
    });
  });

  describe("PUT /indicadores/:id — update", () => {
    test("updates metadata without definicion", async () => {
      const row = makeIndicadorRow();
      mockIndicadorFindByPk.mockResolvedValue(row);

      const app = createTestApp();
      const res = await supertest(app)
        .put(`/indicadores/${INDICADOR_ID}`)
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
        .put(`/indicadores/${INDICADOR_ID}`)
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
        .put(`/indicadores/${INDICADOR_ID}`)
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
        .put(`/indicadores/${INDICADOR_ID}`)
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

    test("rejects unknown encounter_type_uuids with 422 (shared validation)", async () => {
      mockIndicadorFindByPk.mockResolvedValue(makeIndicadorRow());
      mockVersionFindOne.mockResolvedValue(makeVersionRow());
      (validarDefinicionEncounterTypeUuids as jest.Mock).mockResolvedValueOnce([
        "unknown-et-uuid",
      ]);

      const app = createTestApp();
      const res = await supertest(app)
        .put(`/indicadores/${INDICADOR_ID}`)
        .send({
          nombre: "Updated",
          definicion: {
            tipo: "conteo_pacientes",
            evento: { encounter_type_uuids: ["unknown-et-uuid"] },
          },
        });

      expect(res.status).toBe(422);
      expect(res.body.detail.field).toBe("encounter_type_uuids");
      expect(res.body.detail.unknown_uuids).toEqual(["unknown-et-uuid"]);
      expect(mockVersionCreate).not.toHaveBeenCalled();
    });

    test("returns 404 for unknown indicator", async () => {
      mockIndicadorFindByPk.mockResolvedValue(null);

      const app = createTestApp();
      const res = await supertest(app)
        .put(`/indicadores/${INDICADOR_ID}`)
        .send({ nombre: "Updated" });

      expect(res.status).toBe(404);
    });

    test("missing nombre → 422 with exact message 'nombre es obligatorio'", async () => {
      mockIndicadorFindByPk.mockResolvedValue(makeIndicadorRow());

      const app = createTestApp();
      const res = await supertest(app)
        .put(`/indicadores/${INDICADOR_ID}`)
        .send({ descripcion: "only metadata" });

      expect(res.status).toBe(422);
      expect(res.body.detail.field).toBe("nombre");
      expect(res.body.detail.message).toBe("nombre es obligatorio");
    });

    test("empty nombre → 422 with exact message 'nombre es obligatorio'", async () => {
      mockIndicadorFindByPk.mockResolvedValue(makeIndicadorRow());

      const app = createTestApp();
      const res = await supertest(app)
        .put(`/indicadores/${INDICADOR_ID}`)
        .send({ nombre: "   " });

      expect(res.status).toBe(422);
      expect(res.body.detail.field).toBe("nombre");
      expect(res.body.detail.message).toBe("nombre es obligatorio");
    });
  });

  describe("DELETE /indicadores/:id — soft delete", () => {
    test("soft-deletes and returns 204", async () => {
      mockIndicadorFindByPk.mockResolvedValue(makeIndicadorRow());

      const app = createTestApp();
      const res = await supertest(app).delete(`/indicadores/${INDICADOR_ID}`);

      expect(res.status).toBe(204);
    });

    test("returns 404 for unknown", async () => {
      mockIndicadorFindByPk.mockResolvedValue(null);

      const app = createTestApp();
      const res = await supertest(app).delete(`/indicadores/${INDICADOR_ID}`);

      expect(res.status).toBe(404);
    });
  });

  describe("POST /indicadores/:id/versiones — create version", () => {
    test("creates new version and returns 201", async () => {
      mockIndicadorFindByPk.mockResolvedValue(makeIndicadorRow());
      mockVersionMax.mockResolvedValue(2);
      mockVersionCreate.mockResolvedValue(
        makeVersionRow({ version: 3, id: NEW_VERSION_ID }),
      );

      const app = createTestApp();
      const res = await supertest(app)
        .post(`/indicadores/${INDICADOR_ID}/versiones`)
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
        .post(`/indicadores/${INDICADOR_ID}/versiones`)
        .send({
          definicion: {
            tipo: "conteo_atenciones",
          },
        });

      expect(res.status).toBe(404);
    });

    test("rejects a null body with a validation error", async () => {
      mockIndicadorFindByPk.mockResolvedValue(makeIndicadorRow());

      const app = createTestApp();
      const res = await supertest(app)
        .post(`/indicadores/${INDICADOR_ID}/versiones`)
        .send(null);

      expect(res.status).toBe(422);
      expect(res.body.detail.field).toBe("definicion");
      expect(res.body.detail.message).toBe("definicion es obligatorio");
    });

    test("rejects versione with periodo field", async () => {
      mockIndicadorFindByPk.mockResolvedValue(makeIndicadorRow());

      const app = createTestApp();
      const res = await supertest(app)
        .post(`/indicadores/${INDICADOR_ID}/versiones`)
        .send({
          definicion: {
            tipo: "conteo_atenciones",
            periodo: "anual_actual",
          },
        });

      expect(res.status).toBe(422);
      expect(res.body.detail.field).toContain("periodo");
    });

    test("rejects unknown encounter_type_uuids with 422", async () => {
      mockIndicadorFindByPk.mockResolvedValue(makeIndicadorRow());
      (validarDefinicionEncounterTypeUuids as jest.Mock).mockResolvedValueOnce([
        "unknown-et-uuid",
      ]);

      const app = createTestApp();
      const res = await supertest(app)
        .post(`/indicadores/${INDICADOR_ID}/versiones`)
        .send({
          definicion: {
            tipo: "conteo_atenciones",
            evento: { encounter_type_uuids: ["unknown-et-uuid"] },
          },
        });

      expect(res.status).toBe(422);
      expect(res.body.detail.field).toBe("encounter_type_uuids");
      expect(res.body.detail.unknown_uuids).toEqual(["unknown-et-uuid"]);
      expect(mockVersionCreate).not.toHaveBeenCalled();
    });

    test("rejects unknown diagnostico uuids with 422 (shared validation)", async () => {
      mockIndicadorFindByPk.mockResolvedValue(makeIndicadorRow());
      (validarDefinicionDiagnosticoUuids as jest.Mock).mockResolvedValueOnce([
        "unknown-diag-uuid",
      ]);

      const app = createTestApp();
      const res = await supertest(app)
        .post(`/indicadores/${INDICADOR_ID}/versiones`)
        .send({
          definicion: {
            tipo: "conteo_atenciones",
            evento: {
              diagnosticos: [{ concepto_uuids: ["unknown-diag-uuid"] }],
            },
          },
        });

      expect(res.status).toBe(422);
      expect(res.body.detail.field).toBe("diagnosticos");
      expect(res.body.detail.unknown_uuids).toEqual(["unknown-diag-uuid"]);
      expect(mockVersionCreate).not.toHaveBeenCalled();
    });

    test("SC-15: new version auto-copies metas from previous version", async () => {
      mockIndicadorFindByPk.mockResolvedValue(makeIndicadorRow());
      mockVersionMax.mockResolvedValue(1);
      mockVersionCreate.mockResolvedValue(
        makeVersionRow({ version: 2, id: NEW_VERSION_ID }),
      );
      mockVersionFindOne.mockResolvedValue({ id: PREV_VERSION_ID });
      mockSequelizeQuery.mockResolvedValue([]);

      const app = createTestApp();
      const res = await supertest(app)
        .post(`/indicadores/${INDICADOR_ID}/versiones`)
        .send({
          definicion: {
            tipo: "conteo_pacientes",
          },
        });

      expect(res.status).toBe(201);
      expect(res.body.version).toBe(2);
      expect(mockSequelizeQuery).toHaveBeenCalledTimes(1);
      const sqlArg = mockSequelizeQuery.mock.calls[0]?.[0];
      expect(typeof sqlArg).toBe("string");
      expect(sqlArg as string).toMatch(/INSERT INTO indicador_meta/);
      expect(sqlArg as string).toMatch(/ON CONFLICT \(indicador_version_id, anio\) DO NOTHING/);

      const replacements = mockSequelizeQuery.mock.calls[0]?.[1] as { replacements?: Record<string, unknown> };
      expect(replacements?.replacements?.newVersionId).toBe(NEW_VERSION_ID);
      expect(replacements?.replacements?.oldVersionId).toBe(PREV_VERSION_ID);
    });

    test("SC-16: new version with no previous metas starts empty", async () => {
      mockIndicadorFindByPk.mockResolvedValue(makeIndicadorRow());
      mockVersionMax.mockResolvedValue(1);
      mockVersionCreate.mockResolvedValue(
        makeVersionRow({ version: 2, id: NEW_VERSION_ID }),
      );
      mockVersionFindOne.mockResolvedValue({ id: PREV_VERSION_ID });
      mockSequelizeQuery.mockResolvedValue([]);

      const app = createTestApp();
      const res = await supertest(app)
        .post(`/indicadores/${INDICADOR_ID}/versiones`)
        .send({
          definicion: {
            tipo: "conteo_pacientes",
          },
        });

      expect(res.status).toBe(201);
      expect(mockSequelizeQuery).toHaveBeenCalledTimes(1);
    });

    test("SC-17: operator can override inherited meta via PUT /metas", async () => {
      mockIndicadorFindByPk.mockResolvedValue(makeIndicadorRow());
      mockVersionMax.mockResolvedValue(1);
      mockVersionCreate.mockResolvedValue(
        makeVersionRow({ version: 2, id: NEW_VERSION_ID }),
      );
      mockVersionFindOne
        .mockResolvedValueOnce({ id: PREV_VERSION_ID }) // previous version lookup
        .mockResolvedValueOnce({ id: NEW_VERSION_ID }); // version existence check on PUT
      mockSequelizeQuery
        .mockResolvedValueOnce([]) // copy SQL
        .mockResolvedValueOnce([
          {
            id: 7,
            indicador_version_id: NEW_VERSION_ID,
            anio: 2025,
            valor_meta: 2000,
            creado_en: new Date("2026-01-01"),
          },
        ]);

      const app = createTestApp();
      const versionRes = await supertest(app)
        .post(`/indicadores/${INDICADOR_ID}/versiones`)
        .send({
          definicion: {
            tipo: "conteo_pacientes",
          },
        });

      expect(versionRes.status).toBe(201);
      expect(versionRes.body.version).toBe(2);

      const metaRes = await supertest(app).put("/metas").send({
        indicador_version_id: NEW_VERSION_ID,
        anio: 2025,
        valor_meta: 2000,
      });

      expect(metaRes.status).toBe(200);
      expect(metaRes.body.indicador_version_id).toBe(NEW_VERSION_ID);
      expect(metaRes.body.valor_meta).toBe(2000);
    });
  });

  describe("GET /indicadores/:id/preview-sql — SQL preview", () => {
    test("returns SQL preview for latest version (no version param)", async () => {
      mockIndicadorFindByPk.mockResolvedValue(makeIndicadorRow());
      // Latest version is resolved through the shared helper (raw SQL).
      mockSequelizeQuery.mockResolvedValue([makeVersionRow()]);

      const app = createTestApp();
      const res = await supertest(app).get(
        `/indicadores/${INDICADOR_ID}/preview-sql`,
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
        `/indicadores/${INDICADOR_ID}/preview-sql?version_id=${PREV_VERSION_ID}`,
      );

      expect(res.status).toBe(200);
      expect(res.body.version_id).toBe(PREV_VERSION_ID);
    });

    test("accepts versionId (camelCase) and returns preview", async () => {
      mockIndicadorFindByPk.mockResolvedValue(makeIndicadorRow());
      mockVersionFindOne.mockResolvedValue(makeVersionRow());

      const app = createTestApp();
      const res = await supertest(app).get(
        `/indicadores/${INDICADOR_ID}/preview-sql?versionId=${PREV_VERSION_ID}`,
      );

      expect(res.status).toBe(200);
      expect(res.body.version_id).toBe(PREV_VERSION_ID);
    });

    test("versionId takes precedence when both params are present", async () => {
      mockIndicadorFindByPk.mockResolvedValue(makeIndicadorRow());
      // versionFindOne is called with the resolved versionId;
      // verify it received the camelCase value (NEW_VERSION_ID), not the snake_case (PREV_VERSION_ID)
      mockVersionFindOne.mockImplementation(async ({ where }: any) => {
        return where.id === NEW_VERSION_ID
          ? makeVersionRow({ id: NEW_VERSION_ID, version: 2 })
          : null;
      });

      const app = createTestApp();
      const res = await supertest(app).get(
        `/indicadores/${INDICADOR_ID}/preview-sql?versionId=${NEW_VERSION_ID}&version_id=${PREV_VERSION_ID}`,
      );

      expect(res.status).toBe(200);
      expect(res.body.version_id).toBe(NEW_VERSION_ID);
      expect(res.body.version_num).toBe(2);
    });

    test("returns 404 when version not found", async () => {
      mockIndicadorFindByPk.mockResolvedValue(makeIndicadorRow());
      mockVersionFindOne.mockResolvedValue(null);

      const app = createTestApp();
      const res = await supertest(app).get(
        `/indicadores/${INDICADOR_ID}/preview-sql?version_id=wrong-uuid`,
      );

      expect(res.status).toBe(404);
    });
  });
});
