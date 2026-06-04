import { jest } from "@jest/globals";

const mockMysqlQuery = jest.fn();
const mockBulkCreate = jest.fn();
const mockBuild = jest.fn();

jest.mock("../src/database/mysql.js", () => ({
  getMysqlPool: () => ({
    query: mockMysqlQuery,
  }),
}));

jest.mock("../src/models/indicador.js", () => ({
  IndicadorResultado: {
    build: mockBuild,
    bulkCreate: mockBulkCreate,
  },
}));

import { executeAndPersist } from "../src/engine/executor.js";

beforeEach(() => {
  jest.clearAllMocks();
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
});
