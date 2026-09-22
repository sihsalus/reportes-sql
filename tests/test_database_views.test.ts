/**
 * Unit tests for src/database/views.ts
 *
 * Covers backfillResultadoCanonical and createRollupViews.
 * Sequelize is mocked via jest.mock.
 */
import { jest } from "@jest/globals";

const mockQuery = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockAppMetadataFindOne = jest.fn();
const mockAppMetadataCreate = jest.fn();
const mockTx = { id: "synthetic-backfill" };
const mockRollback = jest.fn();

jest.mock("../src/database/postgres.js", () => ({
  sequelize: {
    query: (...args: unknown[]) => mockQuery(...args),
    transaction: async (callback: (tx: unknown) => Promise<unknown>) => {
      try { return await callback(mockTx); }
      catch (error) { mockRollback(); throw error; }
    },
  },
  // Suppress PostgreSQL connection attempt
  initPostgres: jest.fn(),
}));

jest.mock("../src/models/indicador.js", () => ({
  AppMetadata: {
    findOne: (...args: unknown[]) => mockAppMetadataFindOne(...args),
    create: (...args: unknown[]) => mockAppMetadataCreate(...args),
  },
}));

// Suppress logger output
jest.spyOn(console, "info").mockImplementation(() => {});
jest.spyOn(console, "error").mockImplementation(() => {});
jest.spyOn(console, "warn").mockImplementation(() => {});
jest.spyOn(console, "debug").mockImplementation(() => {});

import {
  ensureCanonicalResultIndex,
  backfillResultadoCanonical,
  createRollupViews,
} from "../src/database/views.js";

beforeEach(() => {
  mockRollback.mockClear();
  mockQuery.mockReset();
  mockQuery.mockResolvedValue(undefined);
  mockAppMetadataFindOne.mockReset();
  mockAppMetadataFindOne.mockResolvedValue(null);
  mockAppMetadataCreate.mockReset();
  mockAppMetadataCreate.mockResolvedValue(undefined);
});

describe("ensureCanonicalResultIndex", () => {
  test("creates the partial canonical month index idempotently", async () => {
    await ensureCanonicalResultIndex();

    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockQuery.mock.calls[0]?.[0]).toContain(
      "CREATE INDEX IF NOT EXISTS idx_resultado_canonico_mes",
    );
    expect(mockQuery.mock.calls[0]?.[0]).toContain(
      "WHERE es_canonico = true",
    );
  });
});

describe("backfillResultadoCanonical", () => {
  test("locks before checking the marker and records migration in the same transaction", async () => {
    await backfillResultadoCanonical();
    expect(mockQuery.mock.calls[0]?.[0]).toContain("LOCK TABLE indicador_resultado");
    expect(mockQuery.mock.invocationCallOrder[0]).toBeLessThan(mockAppMetadataFindOne.mock.invocationCallOrder[0]!);
    expect(mockQuery).toHaveBeenCalledTimes(2);
    for (const call of mockQuery.mock.calls) expect(call[1]).toEqual(expect.objectContaining({ transaction: mockTx }));
    expect(mockAppMetadataFindOne).toHaveBeenCalledWith({ where: { key: "canonical_backfill_v2" }, transaction: mockTx });
    expect(mockAppMetadataCreate).toHaveBeenCalledWith({ key: "canonical_backfill_v2", value: "done" }, { transaction: mockTx });
  });

  test("repeated startup locks but does not update already migrated rows", async () => {
    mockAppMetadataFindOne.mockResolvedValue({ key: "canonical_backfill_v2", value: "done" });
    await backfillResultadoCanonical();
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockAppMetadataCreate).not.toHaveBeenCalled();
  });

  test("marker failure rejects the transaction instead of committing unmarked changes", async () => {
    mockAppMetadataCreate.mockRejectedValue(new Error("marker failed"));
    await expect(backfillResultadoCanonical()).rejects.toThrow("marker failed");
    expect(mockRollback).toHaveBeenCalledTimes(1);
  });

  test("data failure rejects without recording a marker", async () => {
    mockQuery.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("update failed"));
    await expect(backfillResultadoCanonical()).rejects.toThrow("update failed");
    expect(mockAppMetadataCreate).not.toHaveBeenCalled();
    expect(mockRollback).toHaveBeenCalledTimes(1);
  });
});

describe("createRollupViews", () => {
  test("creates all 4 rollup views", async () => {
    await createRollupViews();

    expect(mockQuery).toHaveBeenCalledTimes(4);
  });

  test("creates mensual view", async () => {
    await createRollupViews();

    const calls = mockQuery.mock.calls;
    const mensualSql = calls.find((c) =>
      (c[0] as string).includes("vw_resultado_mensual"),
    );
    expect(mensualSql).toBeDefined();
    expect(mensualSql![0]).toContain("CREATE OR REPLACE VIEW");
    expect(mensualSql![0]).toContain("es_canonico = true");
  });

  test("creates trimestral view with quarters", async () => {
    await createRollupViews();

    const calls = mockQuery.mock.calls;
    const trimSql = calls.find((c) =>
      (c[0] as string).includes("vw_resultado_trimestral"),
    );
    expect(trimSql).toBeDefined();
    expect(trimSql![0]).toContain("EXTRACT(QUARTER FROM");
    expect(trimSql![0]).toContain("SUM(ir.valor)");
  });

  test("creates semestral view with semester logic", async () => {
    await createRollupViews();

    const calls = mockQuery.mock.calls;
    const semSql = calls.find((c) =>
      (c[0] as string).includes("vw_resultado_semestral"),
    );
    expect(semSql).toBeDefined();
    expect(semSql![0]).toContain("CASE WHEN EXTRACT(MONTH");
    expect(semSql![0]).toContain("<= 6 THEN 1 ELSE 2");
  });

  test("creates anual view", async () => {
    await createRollupViews();

    const calls = mockQuery.mock.calls;
    const anualSql = calls.find((c) =>
      (c[0] as string).includes("vw_resultado_anual"),
    );
    expect(anualSql).toBeDefined();
    expect(anualSql![0]).toContain("EXTRACT(YEAR FROM");
    expect(anualSql![0]).toContain("TO_CHAR");
  });

  test("all views use RAW query type", async () => {
    await createRollupViews();

    for (const call of mockQuery.mock.calls) {
      const opts = call[1] as Record<string, unknown> | undefined;
      expect(opts?.type).toBeDefined();
    }
  });
});
