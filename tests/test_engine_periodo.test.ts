import { jest } from "@jest/globals";
import { calcularPeriodo, calcularMesActual } from "../src/engine/periodo.js";

describe("calcularPeriodo (legacy)", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  test("anual_actual starts on January 1 of the current UTC year", () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-08-15T22:30:00.000Z"));

    const [inicio, fin] = calcularPeriodo("anual_actual");

    expect(inicio).toEqual(new Date("2026-01-01T00:00:00.000Z"));
    expect(fin).toEqual(new Date("2026-08-15T00:00:00.000Z"));
  });

  test("trimestre_actual starts on the first month of the current UTC quarter", () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-05-20T10:15:00.000Z"));

    const [inicio, fin] = calcularPeriodo("trimestre_actual");

    expect(inicio).toEqual(new Date("2026-04-01T00:00:00.000Z"));
    expect(fin).toEqual(new Date("2026-05-20T00:00:00.000Z"));
  });
});

describe("calcularMesActual", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  test("returns first day of current month as mes_referencia", () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-08-15T22:30:00.000Z"));

    const { inicio, fin, mes_referencia } = calcularMesActual();

    expect(inicio).toEqual(new Date("2026-08-01T00:00:00.000Z"));
    expect(fin).toEqual(new Date("2026-08-15T00:00:00.000Z"));
    expect(mes_referencia).toEqual(new Date("2026-08-01T00:00:00.000Z"));
  });

  test("January has correct mes_referencia", () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-01-10T00:00:00.000Z"));

    const { mes_referencia } = calcularMesActual();

    expect(mes_referencia).toEqual(new Date("2026-01-01T00:00:00.000Z"));
  });

  test("December has correct mes_referencia", () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-12-31T23:59:00.000Z"));

    const { mes_referencia } = calcularMesActual();

    expect(mes_referencia).toEqual(new Date("2026-12-01T00:00:00.000Z"));
  });
});
