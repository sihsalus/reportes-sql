import { jest } from "@jest/globals";
import { calcularMesActual, calcularMesEspecifico } from "../src/engine/periodo.js";

describe("calcularMesActual", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  test("returns first day of current month as mes_referencia", () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-08-15T22:30:00.000Z"));

    const { inicio, fin, finPersistencia, mes_referencia } = calcularMesActual();

    expect(inicio).toEqual(new Date("2026-08-01T00:00:00.000Z"));
    expect(fin).toEqual(new Date("2026-08-15T00:00:00.000Z"));
    expect(finPersistencia).toEqual(new Date("2026-08-31T00:00:00.000Z"));
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

describe("calcularMesEspecifico", () => {
  test("returns the month boundaries in UTC", () => {
    const { inicio, fin, mes_referencia } = calcularMesEspecifico(2026, 8);

    expect(inicio).toEqual(new Date("2026-08-01T00:00:00.000Z"));
    expect(fin).toEqual(new Date("2026-08-31T00:00:00.000Z"));
    expect(mes_referencia).toEqual(inicio);
  });

  test("February ends on the 29th in a leap year", () => {
    const { fin } = calcularMesEspecifico(2024, 2);

    expect(fin).toEqual(new Date("2024-02-29T00:00:00.000Z"));
  });

  test("rejects out-of-range months instead of silently normalizing them", () => {
    // Date.UTC would roll 13 into next January and 0 into previous December.
    for (const mes of [0, 13, -1, 1.5, NaN]) {
      expect(() => calcularMesEspecifico(2026, mes)).toThrow(RangeError);
    }
  });

  test("rejects a non-integer year", () => {
    expect(() => calcularMesEspecifico(2026.5, 1)).toThrow(RangeError);
  });
});
