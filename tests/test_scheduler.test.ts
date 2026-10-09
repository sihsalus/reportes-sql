import { jest } from "@jest/globals";

// ── Mocks ──────────────────────────────────────────────────────────────────

const mockSettings = {
  recalc_hour: 2,
  recalc_ventana_meses: 3,
};

jest.mock("../src/config/index.js", () => ({
  settings: mockSettings,
}));

const mockRecalcularProgramado = jest.fn();
const mockCatchupAnio = jest.fn();
jest.mock("../src/engine/batch.js", () => ({
  recalcularProgramado: (...args: unknown[]) => mockRecalcularProgramado(...args),
  catchupAnio: (...args: unknown[]) => mockCatchupAnio(...args),
}));

const mockLogger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};
jest.mock("../src/config/logger.js", () => ({
  logger: mockLogger,
}));

import {
  runRecalcTick,
  runStartupCatchup,
  startRecalcScheduler,
  stopRecalcScheduler,
} from "../src/scheduler/index.js";

// 2026-03-01T07:30:00Z === 2026-03-01 02:30 America/Lima (UTC-5) → hour 2.

beforeEach(() => {
  jest.clearAllMocks();
  stopRecalcScheduler();
  mockSettings.recalc_hour = 2;
  mockSettings.recalc_ventana_meses = 3;
  mockRecalcularProgramado.mockResolvedValue({
    recalculados: 0,
    errores: [],
    total: 0,
    periodos: [],
  });
  mockCatchupAnio.mockResolvedValue({
    recalculados: 0,
    errores: [],
    total: 0,
    periodos: [],
  });
});

afterEach(() => {
  jest.useRealTimers();
  stopRecalcScheduler();
});

describe("runRecalcTick", () => {
  test("runs nightly when the Lima hour matches, with the configured window", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-03-01T07:30:00.000Z"));

    await runRecalcTick();

    expect(mockRecalcularProgramado).toHaveBeenCalledTimes(1);
    expect(mockRecalcularProgramado).toHaveBeenCalledWith(
      expect.any(Date),
      mockSettings.recalc_ventana_meses,
    );
  });

  test("does not run when the hour does not match", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-03-01T12:00:00.000Z")); // 07:00 Lima

    await runRecalcTick();

    expect(mockRecalcularProgramado).not.toHaveBeenCalled();
  });

  test("runs at most once per day", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-03-01T07:30:00.000Z"));

    await runRecalcTick();
    await runRecalcTick();
    await runRecalcTick();

    expect(mockRecalcularProgramado).toHaveBeenCalledTimes(1);
  });

  test("runs again the next day", async () => {
    jest.useFakeTimers();

    jest.setSystemTime(new Date("2026-03-01T07:30:00.000Z"));
    await runRecalcTick();
    jest.setSystemTime(new Date("2026-03-02T07:30:00.000Z"));
    await runRecalcTick();

    expect(mockRecalcularProgramado).toHaveBeenCalledTimes(2);
  });

  test("swallows errors and logs them", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-03-01T07:30:00.000Z"));
    mockRecalcularProgramado.mockRejectedValueOnce(new Error("boom"));

    await expect(runRecalcTick()).resolves.toBeUndefined();

    expect(mockLogger.error).toHaveBeenCalled();
  });
});

describe("runStartupCatchup", () => {
  test("runs the catch-up", async () => {
    await runStartupCatchup();

    expect(mockCatchupAnio).toHaveBeenCalledTimes(1);
  });

  test("swallows errors and logs them", async () => {
    mockCatchupAnio.mockRejectedValueOnce(new Error("boom"));

    await expect(runStartupCatchup()).resolves.toBeUndefined();

    expect(mockLogger.error).toHaveBeenCalled();
  });
});

describe("startRecalcScheduler", () => {
  test("schedules the nightly tick and stops cleanly", () => {
    const spy = jest.spyOn(globalThis, "setInterval");

    startRecalcScheduler();
    expect(spy).toHaveBeenCalledTimes(1);

    stopRecalcScheduler();
    spy.mockRestore();
  });
});
