import { jest } from "@jest/globals";
import { calcularPeriodo } from "../src/engine/periodo.js";

describe("calcularPeriodo", () => {
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
