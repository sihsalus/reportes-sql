import { jest } from "@jest/globals";

// ── Mocks ──────────────────────────────────────────────────────────────────

const mockIndicadorFindAll = jest.fn();
const mockExecuteAndPersist = jest.fn();
const mockResolveConceptMap = jest.fn();
const mockSequelizeQuery = jest.fn();
const mockCalculoLogCreate = jest.fn();

jest.mock("../src/models/indicador.js", () => ({
  Indicador: {
    findAll: (...args: unknown[]) => mockIndicadorFindAll(...args),
  },
  IndicadorVersion: {},
  IndicadorResultado: {},
  IndicadorCalculoLog: {
    create: (...args: unknown[]) => mockCalculoLogCreate(...args),
  },
}));

jest.mock("../src/database/postgres.js", () => ({
  sequelize: {
    query: (...args: unknown[]) => mockSequelizeQuery(...args),
  },
}));

jest.mock("../src/engine/executor.js", () => ({
  executeAndPersist: (...args: unknown[]) => mockExecuteAndPersist(...args),
}));

jest.mock("../src/validators/openmrs.js", () => ({
  resolveConceptMap: (...args: unknown[]) => mockResolveConceptMap(...args),
}));

jest.mock("../src/config/logger.js", () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import {
  calcularAhora,
  catchupAnio,
  recalcularProgramado,
} from "../src/engine/batch.js";

const INDICADOR_ID = 10;
const VERSION_ID = 100;

const VERSION_ROW = {
  id: VERSION_ID,
  indicador_id: INDICADOR_ID,
  version: 1,
  definicion: { tipo: "conteo_atenciones" },
};

function makeIndicador() {
  return { id: INDICADOR_ID, nombre: "Ind A", activo: true };
}

/** Route `sequelize.query` by SQL: missing-months vs latest-version lookup. */
function mockQuery(mesesFaltantes: Array<{ mes_referencia: string }>) {
  mockSequelizeQuery.mockImplementation(async (sql: unknown) => {
    if (typeof sql !== "string") return [];
    if (sql.includes("generate_series")) return mesesFaltantes;
    if (sql.includes("DISTINCT ON")) return [VERSION_ROW];
    return [];
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockIndicadorFindAll.mockResolvedValue([makeIndicador()]);
  mockResolveConceptMap.mockResolvedValue({});
  mockExecuteAndPersist.mockResolvedValue([]);
  mockCalculoLogCreate.mockResolvedValue(undefined);
  mockQuery([]);
});

describe("calcularAhora", () => {
  test("calculates the current month for active indicators", async () => {
    const res = await calcularAhora();

    expect(mockIndicadorFindAll).toHaveBeenCalledWith({ where: { activo: true } });
    expect(mockExecuteAndPersist).toHaveBeenCalledTimes(1);
    expect(res.recalculados).toBe(1);
    expect(res.total).toBe(1);
    expect(mockExecuteAndPersist).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Object),
      VERSION_ID,
      expect.any(Date),
      expect.any(Date),
      expect.any(Date),
      expect.objectContaining({ indicadorId: INDICADOR_ID, fuente: "calcular-ahora" }),
    );
  });
});

describe("recalcularProgramado", () => {
  test("recalculates a rolling window: current month + previous ones", async () => {
    const res = await recalcularProgramado(
      new Date("2026-03-15T12:00:00.000Z"),
      3,
    );

    expect(res.periodos).toEqual(["2026-01", "2026-02", "2026-03"]);
    expect(mockExecuteAndPersist).toHaveBeenCalledTimes(3);
    for (const call of mockExecuteAndPersist.mock.calls) {
      expect(call[6]).toEqual(
        expect.objectContaining({ indicadorId: INDICADOR_ID, fuente: "scheduler" }),
      );
    }
  });

  test("a window of 1 only covers the current month", async () => {
    const res = await recalcularProgramado(
      new Date("2026-03-15T12:00:00.000Z"),
      1,
    );

    expect(res.periodos).toEqual(["2026-03"]);
    expect(mockExecuteAndPersist).toHaveBeenCalledTimes(1);
  });

  test("rolls over the year boundary", async () => {
    const res = await recalcularProgramado(
      new Date("2026-01-10T12:00:00.000Z"),
      3,
    );

    expect(res.periodos).toEqual(["2025-11", "2025-12", "2026-01"]);
  });
});

describe("catchupAnio", () => {
  test("recalculates the missing months of the current year", async () => {
    mockQuery([{ mes_referencia: "2026-01-01" }]);

    const res = await catchupAnio(new Date("2026-03-15T12:00:00.000Z"));

    expect(res.periodos).toEqual(["2026-01"]);
    expect(mockExecuteAndPersist).toHaveBeenCalledTimes(1);
    expect(mockExecuteAndPersist).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Object),
      VERSION_ID,
      expect.any(Date),
      expect.any(Date),
      expect.any(Date),
      expect.objectContaining({ fuente: "scheduler-catchup" }),
    );
  });

  test("does nothing in January (no closed months yet)", async () => {
    const res = await catchupAnio(new Date("2026-01-10T12:00:00.000Z"));

    expect(res.periodos).toEqual([]);
    expect(mockIndicadorFindAll).not.toHaveBeenCalled();
    expect(mockExecuteAndPersist).not.toHaveBeenCalled();
  });

  test("does nothing when the year has full coverage", async () => {
    mockQuery([]);

    const res = await catchupAnio(new Date("2026-03-15T12:00:00.000Z"));

    expect(res.periodos).toEqual([]);
    expect(mockExecuteAndPersist).not.toHaveBeenCalled();
  });
});
