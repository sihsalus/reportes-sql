/**
 * Integration tests for the resultados router with mocked Sequelize.
 * Covers spec scenarios: list results, batch calculation, error isolation,
 * canonical monthly semantics, and series endpoint.
 */

import { jest } from "@jest/globals";

// ── Mock factory fns ────────────────────────────────────────────────────
const mockResultadoFindAndCountAll = jest.fn();
const mockIndicadorFindAll = jest.fn();
const mockVersionFindOne = jest.fn();
const mockExecuteAndPersist = jest.fn();
const mockResolveConceptMap = jest.fn();
const mockSequelizeQuery = jest.fn();

jest.mock("../src/database/postgres.js", () => ({
  sequelize: {
    query: (...args: unknown[]) => mockSequelizeQuery(...args),
  },
}));

jest.mock("../src/models/indicador.js", () => ({
  Indicador: {
    findAll: (...args: unknown[]) => mockIndicadorFindAll(...args),
  },
  IndicadorVersion: {
    findOne: (...args: unknown[]) => mockVersionFindOne(...args),
  },
  IndicadorResultado: {
    findAndCountAll: (...args: unknown[]) =>
      mockResultadoFindAndCountAll(...args),
  },
}));

jest.mock("../src/engine/executor.js", () => ({
  executeAndPersist: (...args: unknown[]) => mockExecuteAndPersist(...args),
}));

jest.mock("../src/validators/openmrs.js", () => ({
  resolveConceptMap: (...args: unknown[]) =>
    mockResolveConceptMap(...args),
  validarLocations: jest.fn().mockResolvedValue([]),
  validarDefinicionLocationUuids: jest.fn().mockResolvedValue([]),
}));

import express from "express";
import supertest from "supertest";
import { resultadosRouter } from "../src/routers/resultados.js";

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use("/resultados", resultadosRouter);
  return app;
}

const UUID = "00000000-0000-0000-0000-000000000001";
const VERSION_UUID = "00000000-0000-0000-aaaa-000000000001";

function makeIndicador(overrides: Record<string, unknown> = {}) {
  return {
    id: UUID,
    nombre: "Test Indicador",
    descripcion: null,
    activo: true,
    creado_en: new Date("2026-01-01"),
    ...overrides,
  };
}

function makeVersion(overrides: Record<string, unknown> = {}) {
  return {
    id: VERSION_UUID,
    indicador_id: UUID,
    version: 1,
    definicion: {
      tipo: "conteo_atenciones",
    },
    creado_en: new Date("2026-01-01"),
    ...overrides,
  };
}

function makeResultadoRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "r-1",
    indicador_version_id: VERSION_UUID,
    periodo_inicio: "2026-04-01",
    periodo_fin: "2026-04-30",
    valor: 42.5,
    calculado_en: new Date("2026-04-30"),
    mes_referencia: "2026-04-01",
    es_canonico: true,
    indicador_version: {
      id: VERSION_UUID,
      version: 1,
      indicador_id: UUID,
      indicador: { id: UUID, nombre: "Test Indicador" },
    },
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockResolveConceptMap.mockResolvedValue({});
  mockExecuteAndPersist.mockResolvedValue([]);
});

describe("Resultados Router", () => {
  describe("GET /resultados — list results", () => {
    test("returns paginated results with enriched data including canonical fields", async () => {
      mockResultadoFindAndCountAll.mockResolvedValue({
        count: 1,
        rows: [makeResultadoRow()],
      });

      const app = createTestApp();
      const res = await supertest(app).get("/resultados");

      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0].indicador_nombre).toBe("Test Indicador");
      expect(res.body.items[0].es_canonico).toBe(true);
      expect(res.body.items[0].mes_referencia).toBe("2026-04-01");
      expect(res.body.total).toBe(1);
    });

    test("filters by period boundaries", async () => {
      mockResultadoFindAndCountAll.mockResolvedValue({
        count: 0,
        rows: [],
      });

      const app = createTestApp();
      const res = await supertest(app).get(
        "/resultados?periodo_inicio=2026-01-01&periodo_fin=2026-12-31",
      );

      expect(res.status).toBe(200);
    });
  });

  describe("GET /resultados/series — time-series rollups", () => {
    test("returns 422 when indicador_id missing", async () => {
      const app = createTestApp();
      const res = await supertest(app).get("/resultados/series");

      expect(res.status).toBe(422);
      expect(res.body.detail.field).toBe("indicador_id");
    });

    test("returns 422 for invalid granularity", async () => {
      const app = createTestApp();
      const res = await supertest(app).get(
        "/resultados/series?indicador_id=uuid-x&granularity=invalid",
      );

      expect(res.status).toBe(422);
    });

    test("returns monthly series rows", async () => {
      mockSequelizeQuery.mockResolvedValue([
        { periodo_label: "2026-01", valor: "100", meses_disponibles: 1, anio: 2026, mes_referencia: "2026-01-01" },
        { periodo_label: "2026-02", valor: "200", meses_disponibles: 1, anio: 2026, mes_referencia: "2026-02-01" },
      ]);

      const app = createTestApp();
      const res = await supertest(app).get(
        "/resultados/series?indicador_id=uuid-x&anio=2026&granularity=mensual",
      );

      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(2);
      expect(res.body.items[0].periodo_label).toBe("2026-01");
      expect(res.body.items[0].valor).toBe(100);
      expect(res.body.granularity).toBe("mensual");
      expect(res.body.anio).toBe(2026);
    });

    test("returns quarterly rollup rows", async () => {
      mockSequelizeQuery.mockResolvedValue([
        { periodo_label: "Q1", valor: "300", meses_disponibles: 3, anio: 2026, trimestre: 1 },
        { periodo_label: "Q2", valor: "200", meses_disponibles: 2, anio: 2026, trimestre: 2 },
      ]);

      const app = createTestApp();
      const res = await supertest(app).get(
        "/resultados/series?indicador_id=uuid-x&anio=2026&granularity=trimestral",
      );

      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(2);
      expect(res.body.items[0].periodo_label).toBe("Q1");
      expect(res.body.granularity).toBe("trimestral");
    });

    test("returns empty series when no data", async () => {
      mockSequelizeQuery.mockResolvedValue([]);

      const app = createTestApp();
      const res = await supertest(app).get(
        "/resultados/series?indicador_id=uuid-x&granularity=mensual",
      );

      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(0);
    });
  });

  describe("POST /resultados/calcular-ahora — batch calculation", () => {
    test("calculates active indicators for current month and returns summary", async () => {
      mockIndicadorFindAll.mockResolvedValue([makeIndicador()]);
      mockVersionFindOne.mockResolvedValue(makeVersion());
      mockExecuteAndPersist.mockResolvedValue([]);

      const app = createTestApp();
      const res = await supertest(app).post(
        "/resultados/calcular-ahora",
      );

      expect(res.status).toBe(200);
      expect(res.body.calculados).toBe(1);
      expect(res.body.errores).toHaveLength(0);
      expect(res.body.total).toBe(1);
      // Verify mes_referencia is included in response
      expect(res.body.mes_referencia).toBeDefined();
      // Verify executeAndPersist was called with mesReferencia
      expect(mockExecuteAndPersist).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Object),
        VERSION_UUID,
        expect.any(Date),
        expect.any(Date),
        expect.any(Date), // mes_referencia
      );
    });

    test("reports error for indicator without versions", async () => {
      mockIndicadorFindAll.mockResolvedValue([makeIndicador()]);
      mockVersionFindOne.mockResolvedValue(null);

      const app = createTestApp();
      const res = await supertest(app).post(
        "/resultados/calcular-ahora",
      );

      expect(res.status).toBe(200);
      expect(res.body.calculados).toBe(0);
      expect(res.body.errores).toHaveLength(1);
      expect(res.body.errores[0].error).toBe("Sin versiones definidas");
    });

    test("isolates failures — one fails, others succeed", async () => {
      const ind1 = makeIndicador({ id: "uuid-1", nombre: "Ind 1" });
      const ind2 = makeIndicador({ id: "uuid-2", nombre: "Ind 2" });
      mockIndicadorFindAll.mockResolvedValue([ind1, ind2]);
      mockVersionFindOne
        .mockResolvedValueOnce(makeVersion({ indicador_id: "uuid-1" }))
        .mockResolvedValueOnce(null);

      const app = createTestApp();
      const res = await supertest(app).post(
        "/resultados/calcular-ahora",
      );

      expect(res.status).toBe(200);
      expect(res.body.calculados).toBe(1);
      expect(res.body.errores).toHaveLength(1);
      expect(res.body.errores[0].indicador_nombre).toBe("Ind 2");
      expect(res.body.total).toBe(2);
    });

    test("handles empty indicator list", async () => {
      mockIndicadorFindAll.mockResolvedValue([]);

      const app = createTestApp();
      const res = await supertest(app).post(
        "/resultados/calcular-ahora",
      );

      expect(res.status).toBe(200);
      expect(res.body.calculados).toBe(0);
      expect(res.body.total).toBe(0);
    });
  });
});
