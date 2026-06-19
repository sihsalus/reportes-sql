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
        "/resultados/series?indicador_id=uuid-x&anio=2026&granularity=invalid",
      );

      expect(res.status).toBe(422);
      expect(res.body.detail.field).toBe("granularity");
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

    test("annual SQL uses an aggregate-safe period label (regression: 500 on /series?granularity=anual)", async () => {
      // PostgreSQL rejects SELECT TO_CHAR(mes_referencia, 'YYYY') when the
      // query only groups by EXTRACT(YEAR FROM mes_referencia) — the column
      // must appear inside an aggregate (e.g. MIN(mes_referencia)) to match
      // the GROUP BY clause. This test pins the contract to the same pattern
      // used in src/database/views.ts (vw_resultado_anual).
      mockSequelizeQuery.mockResolvedValue([
        { periodo_label: "2026", valor: "1500", meses_disponibles: 12, anio: 2026 },
      ]);

      const app = createTestApp();
      await supertest(app).get(
        "/resultados/series?indicador_id=uuid-x&anio=2026&granularity=anual",
      );

      expect(mockSequelizeQuery).toHaveBeenCalledTimes(1);
      const sqlArg = mockSequelizeQuery.mock.calls[0]?.[0];
      expect(typeof sqlArg).toBe("string");

      // Aggregate-safe: period label derived from MIN(mes_referencia) like the view.
      expect(sqlArg as string).toMatch(/TO_CHAR\(\s*MIN\(\s*mes_referencia\s*\)\s*,\s*'YYYY'\s*\)/i);

      // Regression guard: the unaggregated form that triggered the 500 must not
      // be present (TO_CHAR(mes_referencia, 'YYYY') without MIN/Max/Sum wrapper).
      expect(sqlArg as string).not.toMatch(/TO_CHAR\(\s*mes_referencia\s*,\s*'YYYY'\s*\)/i);
    });

    test("returns annual rollup rows", async () => {
      mockSequelizeQuery.mockResolvedValue([
        { periodo_label: "2026", valor: "1500.5", meses_disponibles: 12, anio: 2026 },
      ]);

      const app = createTestApp();
      const res = await supertest(app).get(
        "/resultados/series?indicador_id=uuid-x&anio=2026&granularity=anual",
      );

      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0].periodo_label).toBe("2026");
      expect(res.body.items[0].valor).toBe(1500.5);
      expect(res.body.items[0].meses_disponibles).toBe(12);
      expect(res.body.items[0].anio).toBe(2026);
      expect(res.body.granularity).toBe("anual");
      expect(res.body.anio).toBe(2026);
      expect(res.body.indicador_id).toBe("uuid-x");
    });

    test("returns empty series when no data", async () => {
      mockSequelizeQuery.mockResolvedValue([]);

      const app = createTestApp();
      const res = await supertest(app).get(
        "/resultados/series?indicador_id=uuid-x&anio=2026&granularity=mensual",
      );

      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(0);
    });

    test("rejects missing anio", async () => {
      const app = createTestApp();
      const res = await supertest(app).get(
        "/resultados/series?indicador_id=uuid-x",
      );

      expect(res.status).toBe(422);
      expect(res.body.detail.field).toBe("anio");
      expect(res.body.detail.message).toMatch(/obligatorio/);
    });

    test("rejects anio with trailing garbage (e.g. 2026abc)", async () => {
      const app = createTestApp();
      const res = await supertest(app).get(
        "/resultados/series?indicador_id=uuid-x&anio=2026abc",
      );

      expect(res.status).toBe(422);
      expect(res.body.detail.field).toBe("anio");
      expect(res.body.detail.message).toMatch(/entero/);
    });

    test("rejects decimal anio", async () => {
      const app = createTestApp();
      const res = await supertest(app).get(
        "/resultados/series?indicador_id=uuid-x&anio=2026.5",
      );

      expect(res.status).toBe(422);
      expect(res.body.detail.field).toBe("anio");
      expect(res.body.detail.message).toMatch(/entero/);
    });

    test("rejects anio below 2000", async () => {
      const app = createTestApp();
      const res = await supertest(app).get(
        "/resultados/series?indicador_id=uuid-x&anio=1999",
      );

      expect(res.status).toBe(422);
      expect(res.body.detail.field).toBe("anio");
      expect(res.body.detail.message).toMatch(/2000-2100/);
    });

    test("rejects anio above 2100", async () => {
      const app = createTestApp();
      const res = await supertest(app).get(
        "/resultados/series?indicador_id=uuid-x&anio=2101",
      );

      expect(res.status).toBe(422);
      expect(res.body.detail.field).toBe("anio");
      expect(res.body.detail.message).toMatch(/2000-2100/);
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

  describe("POST /resultados/recalcular-anio — annual historical recalculation", () => {
    test("rejects future years", async () => {
      const app = createTestApp();
      const res = await supertest(app)
        .post("/resultados/recalcular-anio")
        .send({ anio: 2099 });

      expect(res.status).toBe(422);
      expect(res.body.detail.field).toBe("anio");
    });

    test("rejects non-integer anio", async () => {
      const app = createTestApp();
      const res = await supertest(app)
        .post("/resultados/recalcular-anio")
        .send({ anio: "2025" });

      expect(res.status).toBe(422);
      expect(res.body.detail.field).toBe("anio");
    });

    test("rejects missing anio", async () => {
      const app = createTestApp();
      const res = await supertest(app)
        .post("/resultados/recalcular-anio")
        .send({});

      expect(res.status).toBe(422);
      expect(res.body.detail.field).toBe("anio");
    });

    test("rejects anio below 2000", async () => {
      const app = createTestApp();
      const res = await supertest(app)
        .post("/resultados/recalcular-anio")
        .send({ anio: 1999 });

      expect(res.status).toBe(422);
      expect(res.body.detail.field).toBe("anio");
      expect(res.body.detail.message).toMatch(/>= 2000/);
    });

    test("past year processes all 12 months", async () => {
      mockIndicadorFindAll.mockResolvedValue([makeIndicador()]);
      mockVersionFindOne.mockResolvedValue(makeVersion());
      mockExecuteAndPersist.mockResolvedValue([]);

      const app = createTestApp();
      const res = await supertest(app)
        .post("/resultados/recalcular-anio")
        .send({ anio: 2025 });

      expect(res.status).toBe(200);
      expect(res.body.anio).toBe(2025);
      expect(res.body.meses_procesados).toBe(12);
      expect(res.body.indicadores_considerados).toBe(1);
      expect(res.body.recalculados).toBe(12);
      expect(res.body.errores).toHaveLength(0);
      expect(mockExecuteAndPersist).toHaveBeenCalledTimes(12);
    });

    test("current year processes only up to current month", async () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date("2026-04-15T00:00:00.000Z"));

      mockIndicadorFindAll.mockResolvedValue([makeIndicador()]);
      mockVersionFindOne.mockResolvedValue(makeVersion());
      mockExecuteAndPersist.mockResolvedValue([]);

      const app = createTestApp();
      const res = await supertest(app)
        .post("/resultados/recalcular-anio")
        .send({ anio: 2026 });

      expect(res.status).toBe(200);
      expect(res.body.anio).toBe(2026);
      expect(res.body.meses_procesados).toBe(4);
      expect(res.body.recalculados).toBe(4);
      expect(mockExecuteAndPersist).toHaveBeenCalledTimes(4);

      // Verify month-specific periods were passed
      const firstCall = mockExecuteAndPersist.mock.calls[0];
      expect(firstCall[3]).toEqual(new Date("2026-01-01T00:00:00.000Z")); // inicio
      expect(firstCall[4]).toEqual(new Date("2026-01-31T00:00:00.000Z")); // fin
      expect(firstCall[5]).toEqual(new Date("2026-01-01T00:00:00.000Z")); // mes_referencia

      jest.useRealTimers();
    });

    test("scopes to specific indicador_id", async () => {
      const inactiveInd = makeIndicador({ id: "uuid-inactive", nombre: "Inactive", activo: false });
      mockIndicadorFindAll.mockImplementation(async (options: unknown) => {
        const opts = options as { where?: { id?: string } };
        if (opts?.where?.id === "uuid-inactive") {
          return [inactiveInd];
        }
        return [];
      });
      mockVersionFindOne.mockResolvedValue(makeVersion({ indicador_id: "uuid-inactive" }));
      mockExecuteAndPersist.mockResolvedValue([]);

      const app = createTestApp();
      const res = await supertest(app)
        .post("/resultados/recalcular-anio")
        .send({ anio: 2025, indicador_id: "uuid-inactive" });

      expect(res.status).toBe(200);
      expect(res.body.indicador_id).toBe("uuid-inactive");
      expect(res.body.indicadores_considerados).toBe(1);
      expect(res.body.recalculados).toBe(12);
      expect(mockIndicadorFindAll).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: "uuid-inactive" } }),
      );
    });

    test("returns 422 when indicador_id not found", async () => {
      mockIndicadorFindAll.mockResolvedValue([]);

      const app = createTestApp();
      const res = await supertest(app)
        .post("/resultados/recalcular-anio")
        .send({ anio: 2025, indicador_id: "nonexistent" });

      expect(res.status).toBe(422);
      expect(res.body.detail.field).toBe("indicador_id");
    });

    test("isolates failures per month and continues", async () => {
      mockIndicadorFindAll.mockResolvedValue([makeIndicador()]);
      mockVersionFindOne
        .mockResolvedValueOnce(makeVersion())
        .mockResolvedValueOnce(makeVersion())
        .mockResolvedValueOnce(makeVersion())
        .mockResolvedValueOnce(makeVersion())
        .mockResolvedValueOnce(makeVersion())
        .mockResolvedValueOnce(null) // fail month 6
        .mockResolvedValue(makeVersion());

      mockExecuteAndPersist.mockResolvedValue([]);

      const app = createTestApp();
      const res = await supertest(app)
        .post("/resultados/recalcular-anio")
        .send({ anio: 2025 });

      expect(res.status).toBe(200);
      expect(res.body.recalculados).toBe(11);
      expect(res.body.errores).toHaveLength(1);
      expect(res.body.errores[0].mes).toBe(6);
      expect(res.body.errores[0].error).toBe("Sin versiones definidas");
      expect(mockExecuteAndPersist).toHaveBeenCalledTimes(11);
    });

    test("handles empty indicator list", async () => {
      mockIndicadorFindAll.mockResolvedValue([]);

      const app = createTestApp();
      const res = await supertest(app)
        .post("/resultados/recalcular-anio")
        .send({ anio: 2025 });

      expect(res.status).toBe(200);
      expect(res.body.recalculados).toBe(0);
      expect(res.body.total).toBe(0);
    });
  });
});
