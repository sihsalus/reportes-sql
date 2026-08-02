import { jest } from "@jest/globals";

const mockMysqlQuery = jest.fn();
const mockBulkCreate = jest.fn();
const mockBuild = jest.fn();
const mockUpdate = jest.fn();
const mockSequelizeQuery = jest.fn();
const mockCalculoLogCreate = jest.fn();

// Mock transaction
const mockTransaction = {
  commit: jest.fn().mockResolvedValue(undefined),
  rollback: jest.fn().mockResolvedValue(undefined),
};
const mockSequelizeTransaction = jest.fn().mockResolvedValue(mockTransaction);

jest.mock("../src/database/mysql.js", () => ({
  getMysqlPool: () => ({
    query: mockMysqlQuery,
  }),
  queryMysql: jest.fn(async (sql: string, params: unknown) => {
    // Forward to mockMysqlQuery preserving the call shape that tests expect
    const [rows] = await mockMysqlQuery({ sql, namedPlaceholders: true, values: params });
    return rows;
  }),
}));

jest.mock("../src/database/postgres.js", () => ({
  sequelize: {
    transaction: () => mockSequelizeTransaction(),
    query: (...args: unknown[]) => mockSequelizeQuery(...args),
  },
}));

jest.mock("../src/models/indicador.js", () => ({
  IndicadorResultado: {
    build: mockBuild,
    bulkCreate: mockBulkCreate,
    update: mockUpdate,
  },
  IndicadorCalculoLog: {
    create: mockCalculoLogCreate,
  },
}));

import { executeAndPersist } from "../src/engine/executor.js";

beforeEach(() => {
  jest.clearAllMocks();
  mockSequelizeTransaction.mockResolvedValue(mockTransaction);
  mockCalculoLogCreate.mockResolvedValue(undefined);
  // clearAllMocks does NOT remove implementations — pin safe defaults so
  // rejections set by one test never leak into later ones.
  mockUpdate.mockResolvedValue([1]);
  mockSequelizeQuery.mockResolvedValue([undefined, 1]);
});

describe("executeAndPersist", () => {
  test("does not call bulkCreate when MySQL returns zero rows", async () => {
    mockMysqlQuery.mockResolvedValue([[], []]);

    const results = await executeAndPersist(
      "SELECT 1 WHERE false",
      { location: "test-location" },
      "version-1",
      new Date("2026-01-01T00:00:00.000Z"),
      new Date("2026-01-31T00:00:00.000Z"),
    );

    expect(results).toEqual([]);
    expect(mockMysqlQuery).toHaveBeenCalledWith({
      sql: "SELECT 1 WHERE false",
      namedPlaceholders: true,
      values: { location: "test-location" },
    });
    expect(mockBuild).not.toHaveBeenCalled();
    expect(mockBulkCreate).not.toHaveBeenCalled();
  });

  test("builds and persists results with canonical semantics", async () => {
    mockMysqlQuery.mockResolvedValue([
      [{ valor: 42 }],
      [],
    ]);

    const builtInstance = {
      toJSON: () => ({
        indicador_version_id: "version-1",
        periodo_inicio: new Date("2026-08-01T00:00:00.000Z"),
        periodo_fin: new Date("2026-08-15T00:00:00.000Z"),
        valor: 42,
        calculado_en: new Date(),
        mes_referencia: new Date("2026-08-01T00:00:00.000Z"),
        es_canonico: true,
      }),
    };
    mockBuild.mockReturnValue(builtInstance);
    mockBulkCreate.mockResolvedValue([builtInstance]);
    mockUpdate.mockResolvedValue([1]);

    const mesRef = new Date("2026-08-01T00:00:00.000Z");
    const results = await executeAndPersist(
      "SELECT COUNT(*) as valor FROM encounter e WHERE ...",
      { inicio: "2026-08-01", fin_excl: "2026-08-16" },
      "version-1",
      new Date("2026-08-01T00:00:00.000Z"),
      new Date("2026-08-15T00:00:00.000Z"),
      mesRef,
    );

    expect(results).toHaveLength(1);
    expect(mockUpdate).toHaveBeenCalledWith(
      { es_canonico: false },
      expect.objectContaining({
        where: {
          indicador_version_id: "version-1",
          mes_referencia: mesRef,
          es_canonico: true,
        },
      }),
    );
    expect(mockBulkCreate).toHaveBeenCalled();
    expect(mockTransaction.commit).toHaveBeenCalled();
  });

  test("rolls back on error", async () => {
    mockMysqlQuery.mockResolvedValue([
      [{ valor: 42 }],
      [],
    ]);
    mockBuild.mockReturnValue({
      toJSON: () => ({ valor: 42 }),
    });
    mockUpdate.mockRejectedValue(new Error("DB error"));

    const mesRef = new Date("2026-08-01T00:00:00.000Z");
    await expect(
      executeAndPersist(
        "SELECT 1",
        {},
        "version-1",
        new Date("2026-08-01"),
        new Date("2026-08-15"),
        mesRef,
      ),
    ).rejects.toThrow("DB error");

    expect(mockTransaction.rollback).toHaveBeenCalled();
    expect(mockTransaction.commit).not.toHaveBeenCalled();
  });

  test("supersedes canonical rows across versions when indicadorId is provided", async () => {
    mockMysqlQuery.mockResolvedValue([
      [{ valor: 42 }],
      [],
    ]);
    const builtInstance = {
      toJSON: () => ({
        indicador_version_id: "version-2",
        periodo_inicio: new Date("2026-08-01T00:00:00.000Z"),
        periodo_fin: new Date("2026-08-15T00:00:00.000Z"),
        valor: 42,
        calculado_en: new Date(),
        mes_referencia: new Date("2026-08-01T00:00:00.000Z"),
        es_canonico: true,
      }),
    };
    mockBuild.mockReturnValue(builtInstance);
    mockBulkCreate.mockResolvedValue([builtInstance]);
    mockUpdate.mockResolvedValue([1]);
    mockSequelizeQuery.mockResolvedValue([undefined, 1]);

    const mesRef = new Date("2026-08-01T00:00:00.000Z");

    // 1) First version computed WITHOUT indicadorId → legacy version-scoped update
    await executeAndPersist(
      "SELECT 1",
      {},
      "version-1",
      new Date("2026-08-01"),
      new Date("2026-08-15"),
      mesRef,
    );
    expect(mockUpdate).toHaveBeenCalledWith(
      { es_canonico: false },
      expect.objectContaining({
        where: {
          indicador_version_id: "version-1",
          mes_referencia: mesRef,
          es_canonico: true,
        },
      }),
    );

    // 2) Second version computed WITH indicadorId → cross-version supersede
    await executeAndPersist(
      "SELECT 1",
      {},
      "version-2",
      new Date("2026-08-01"),
      new Date("2026-08-15"),
      mesRef,
      {
        indicadorId: "indicador-1",
        fuente: "test-fuente",
        persistirCeroSiVacio: true,
      },
    );

    // The legacy model update must NOT run for the cross-version path
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockSequelizeQuery).toHaveBeenCalledTimes(1);
    expect(mockSequelizeQuery).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE indicador_resultado ir"),
      expect.objectContaining({
        replacements: {
          indicador_id: "indicador-1",
          mes_referencia: "2026-08-01",
        },
      }),
    );
    const crossVersionSql = mockSequelizeQuery.mock.calls[0]?.[0] as string;
    expect(crossVersionSql).toContain("FROM indicador_version iv");
    expect(crossVersionSql).toContain("iv.indicador_id = :indicador_id");
    expect(crossVersionSql).toContain("ir.mes_referencia = :mes_referencia");
    expect(crossVersionSql).toContain("ir.es_canonico = true");

    // Exactly one canonical row is persisted (the new version's row)
    expect(mockBulkCreate).toHaveBeenLastCalledWith(
      [expect.objectContaining({ es_canonico: true, indicador_version_id: "version-2" })],
      expect.any(Object),
    );
  });

  test("persists a zero-valued row when MySQL returns empty and persistirCeroSiVacio is enabled", async () => {
    mockMysqlQuery.mockResolvedValue([[], []]);
    const zeroInstance = {
      toJSON: () => ({
        indicador_version_id: "version-1",
        valor: 0,
        es_canonico: true,
      }),
    };
    mockBuild.mockReturnValue(zeroInstance);
    mockBulkCreate.mockResolvedValue([zeroInstance]);
    mockSequelizeQuery.mockResolvedValue([undefined, 1]);

    const mesRef = new Date("2026-08-01T00:00:00.000Z");
    const results = await executeAndPersist(
      "SELECT 1 WHERE false",
      {},
      "version-1",
      new Date("2026-08-01"),
      new Date("2026-08-15"),
      mesRef,
      {
        indicadorId: "indicador-1",
        persistirCeroSiVacio: true,
      },
    );

    expect(mockBuild).toHaveBeenCalledWith(
      expect.objectContaining({
        indicador_version_id: "version-1",
        valor: 0,
        mes_referencia: mesRef,
        es_canonico: true,
      }),
    );
    expect(mockBulkCreate).toHaveBeenCalled();
    expect(results).toHaveLength(1);
    // Ledger: 0 rows returned, 1 row persisted
    expect(mockCalculoLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "success",
        filas_devueltas: 0,
        filas_persistidas: 1,
      }),
    );
  });

  test("records a success ledger entry after commit with the expected fields", async () => {
    mockMysqlQuery.mockResolvedValue([
      [{ valor: 42 }],
      [],
    ]);
    const builtInstance = {
      toJSON: () => ({
        indicador_version_id: "version-1",
        valor: 42,
        es_canonico: true,
      }),
    };
    mockBuild.mockReturnValue(builtInstance);
    mockBulkCreate.mockResolvedValue([builtInstance]);
    mockUpdate.mockResolvedValue([1]);

    const mesRef = new Date("2026-08-01T00:00:00.000Z");
    const results = await executeAndPersist(
      "SELECT 1",
      {},
      "version-1",
      new Date("2026-08-01"),
      new Date("2026-08-15"),
      mesRef,
      {
        indicadorId: "indicador-1",
        fuente: "calcular-ahora",
      },
    );

    expect(results).toHaveLength(1);
    expect(mockCalculoLogCreate).toHaveBeenCalledTimes(1);
    expect(mockCalculoLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "success",
        indicador_id: "indicador-1",
        indicador_version_id: "version-1",
        mes_referencia: mesRef,
        filas_devueltas: 1,
        filas_persistidas: 1,
        duracion_ms: expect.any(Number),
        error: null,
        fuente: "calcular-ahora",
        creado_en: expect.any(Date),
      }),
    );
    expect(mockTransaction.commit).toHaveBeenCalled();
  });

  test("records an error ledger entry and rethrows the original error", async () => {
    mockMysqlQuery.mockResolvedValue([
      [{ valor: 42 }],
      [],
    ]);
    mockBuild.mockReturnValue({
      toJSON: () => ({ valor: 42 }),
    });
    // indicadorId present → cross-version supersede runs via sequelize.query
    mockSequelizeQuery.mockRejectedValue(new Error("DB error"));

    const mesRef = new Date("2026-08-01T00:00:00.000Z");
    await expect(
      executeAndPersist(
        "SELECT 1",
        {},
        "version-1",
        new Date("2026-08-01"),
        new Date("2026-08-15"),
        mesRef,
        {
          indicadorId: "indicador-1",
          fuente: "recalcular-anio",
        },
      ),
    ).rejects.toThrow("DB error");

    expect(mockTransaction.rollback).toHaveBeenCalled();
    expect(mockCalculoLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "error",
        indicador_id: "indicador-1",
        indicador_version_id: "version-1",
        mes_referencia: mesRef,
        error: "DB error",
        duracion_ms: expect.any(Number),
        fuente: "recalcular-anio",
      }),
    );
  });

  test("ledger write failures never fail the calculation", async () => {
    mockCalculoLogCreate.mockRejectedValue(new Error("ledger db down"));
    mockMysqlQuery.mockResolvedValue([
      [{ valor: 7 }],
      [],
    ]);
    mockBuild.mockReturnValue({
      toJSON: () => ({ valor: 7 }),
    });
    mockBulkCreate.mockResolvedValue([]);
    mockUpdate.mockResolvedValue([1]);

    const mesRef = new Date("2026-08-01T00:00:00.000Z");

    // Success path: log write fails → calculation still returns results
    const results = await executeAndPersist(
      "SELECT 1",
      {},
      "version-1",
      new Date("2026-08-01"),
      new Date("2026-08-15"),
      mesRef,
      { indicadorId: "indicador-1", fuente: "calcular-ahora" },
    );
    expect(results).toHaveLength(1);
    expect(mockCalculoLogCreate).toHaveBeenCalledTimes(1);

    // Error path: log write fails → original error still propagates
    mockSequelizeQuery.mockRejectedValue(new Error("DB error"));
    await expect(
      executeAndPersist(
        "SELECT 1",
        {},
        "version-1",
        new Date("2026-08-01"),
        new Date("2026-08-15"),
        mesRef,
        { indicadorId: "indicador-1", fuente: "calcular-ahora" },
      ),
    ).rejects.toThrow("DB error");
  });

  test("records a success ledger entry for empty results without zero-fill", async () => {
    mockMysqlQuery.mockResolvedValue([[], []]);

    await executeAndPersist(
      "SELECT 1 WHERE false",
      {},
      "version-1",
      new Date("2026-08-01"),
      new Date("2026-08-15"),
    );

    expect(mockBuild).not.toHaveBeenCalled();
    expect(mockBulkCreate).not.toHaveBeenCalled();
    expect(mockCalculoLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "success",
        indicador_id: null,
        indicador_version_id: "version-1",
        mes_referencia: null,
        filas_devueltas: 0,
        filas_persistidas: 0,
        fuente: null,
      }),
    );
  });
});
