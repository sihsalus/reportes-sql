/**
 * Tests for the unified calc-ledger writer (src/engine/calc-log.ts).
 *
 * Verifies the success path writes the row and the failure path logs a
 * warning without throwing, so a ledger failure can never mask the
 * calculation that triggered it.
 */
import { jest } from "@jest/globals";

const mockCalculoLogCreate = jest.fn();
const consoleWarn = jest.spyOn(console, "warn").mockImplementation(() => {});

jest.mock("../src/models/indicador.js", () => ({
  IndicadorCalculoLog: {
    create: (...args: unknown[]) => mockCalculoLogCreate(...args),
  },
}));

import { writeCalcLog } from "../src/engine/calc-log.js";

beforeEach(() => {
  jest.clearAllMocks();
  mockCalculoLogCreate.mockResolvedValue(undefined);
});

afterAll(() => {
  consoleWarn.mockRestore();
});

describe("writeCalcLog", () => {
  test("success path — creates a log row with creado_en", async () => {
    const before = Date.now();
    await writeCalcLog({
      status: "success",
      indicador_id: "ind-1",
      indicador_version_id: "ver-1",
      mes_referencia: new Date("2026-04-01"),
      filas_devueltas: 5,
      filas_persistidas: 5,
      duracion_ms: 42,
      error: null,
      fuente: "calcular-ahora",
    });
    const after = Date.now();

    expect(mockCalculoLogCreate).toHaveBeenCalledTimes(1);
    const row = mockCalculoLogCreate.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(row).toMatchObject({
      status: "success",
      indicador_id: "ind-1",
      indicador_version_id: "ver-1",
      filas_devueltas: 5,
      filas_persistidas: 5,
      duracion_ms: 42,
      error: null,
      fuente: "calcular-ahora",
    });
    expect(row["creado_en"]).toBeInstanceOf(Date);
    const ts = (row["creado_en"] as Date).getTime();
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });

  test("error-only entry defaults status to 'error' and filas/duracion to null", async () => {
    await writeCalcLog({
      indicador_id: "ind-1",
      indicador_version_id: null,
      mes_referencia: new Date("2026-04-01"),
      error: "Boom",
      fuente: "recalcular-anio",
    });

    expect(mockCalculoLogCreate).toHaveBeenCalledTimes(1);
    const row = mockCalculoLogCreate.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(row).toMatchObject({
      status: "error",
      indicador_id: "ind-1",
      indicador_version_id: null,
      filas_devueltas: null,
      filas_persistidas: null,
      duracion_ms: null,
      error: "Boom",
      fuente: "recalcular-anio",
    });
  });

  test("failure path — logs warn and does NOT throw", async () => {
    mockCalculoLogCreate.mockRejectedValueOnce(new Error("DB down"));

    await expect(
      writeCalcLog({
        indicador_id: "ind-1",
        indicador_version_id: "ver-1",
        mes_referencia: null,
        error: "calc failed",
        fuente: "calcular-ahora",
      }),
    ).resolves.toBeUndefined();

    expect(consoleWarn).toHaveBeenCalledTimes(1);
    const line = consoleWarn.mock.calls[0]?.[0] as string;
    expect(line).toContain("Failed to write indicador_calculo_log entry");
  });
});