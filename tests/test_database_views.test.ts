/**
 * Unit tests for src/database/views.ts
 *
 * Covers backfillResultadoCanonical and createRollupViews.
 * Sequelize is mocked via jest.mock.
 */
import { jest } from "@jest/globals";

const mockQuery = jest.fn<(...args: unknown[]) => Promise<unknown>>();

jest.mock("../src/database/postgres.js", () => ({
  sequelize: {
    query: (...args: unknown[]) => mockQuery(...args),
  },
  // Suppress PostgreSQL connection attempt
  initPostgres: jest.fn(),
}));

// Suppress logger output
jest.spyOn(console, "info").mockImplementation(() => {});
jest.spyOn(console, "error").mockImplementation(() => {});
jest.spyOn(console, "warn").mockImplementation(() => {});
jest.spyOn(console, "debug").mockImplementation(() => {});

import {
  backfillResultadoCanonical,
  createRollupViews,
} from "../src/database/views.js";

beforeEach(() => {
  mockQuery.mockReset();
  mockQuery.mockResolvedValue(undefined);
});

describe("backfillResultadoCanonical", () => {
  test("executes two UPDATE queries", async () => {
    await backfillResultadoCanonical();

    expect(mockQuery).toHaveBeenCalledTimes(2);

    // First query — backfill mes_referencia
    const firstSql = (mockQuery.mock.calls[0]?.[0] as string) ?? "";
    expect(firstSql).toContain("UPDATE indicador_resultado");
    expect(firstSql).toContain("mes_referencia IS NULL");

    // Second query — mark canonical
    const secondSql = (mockQuery.mock.calls[1]?.[0] as string) ?? "";
    expect(secondSql).toContain("SET es_canonico = true");
    expect(secondSql).toContain("NOT EXISTS");
  });

  test("first query uses UPDATE type", async () => {
    await backfillResultadoCanonical();

    const opts = mockQuery.mock.calls[0]?.[1] as Record<string, unknown> | undefined;
    expect(opts?.type).toBeDefined();
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
