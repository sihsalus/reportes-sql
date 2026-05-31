/**
 * Integration tests for the resultados router with mocked Sequelize.
 * Covers spec scenarios: list results, batch calculation, error isolation.
 */

import { jest } from "@jest/globals";

// ── Mock factory fns ────────────────────────────────────────────────────
const mockResultadoFindAndCountAll = jest.fn();
const mockIndicadorFindAll = jest.fn();
const mockVersionFindOne = jest.fn();
const mockExecuteAndPersist = jest.fn();
const mockResolveConceptMap = jest.fn();

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
      periodo: "mes_actual",
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
    test("returns paginated results with enriched data", async () => {
      mockResultadoFindAndCountAll.mockResolvedValue({
        count: 1,
        rows: [makeResultadoRow()],
      });

      const app = createTestApp();
      const res = await supertest(app).get("/resultados");

      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0].indicador_nombre).toBe("Test Indicador");
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

  describe("POST /resultados/calcular-ahora — batch calculation", () => {
    test("calculates active indicators and returns summary", async () => {
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
