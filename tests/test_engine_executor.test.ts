import { jest } from "@jest/globals";

const mockMysqlQuery = jest.fn();
const mockBulkCreate = jest.fn();
const mockBuild = jest.fn();
const mockUpdate = jest.fn();

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
  },
}));

jest.mock("../src/models/indicador.js", () => ({
  IndicadorResultado: {
    build: mockBuild,
    bulkCreate: mockBulkCreate,
    update: mockUpdate,
  },
}));

import { executeAndPersist } from "../src/engine/executor.js";

beforeEach(() => {
  jest.clearAllMocks();
  mockSequelizeTransaction.mockResolvedValue(mockTransaction);
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
});
