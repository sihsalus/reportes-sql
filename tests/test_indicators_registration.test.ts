import { jest } from "@jest/globals";

const mockIndicadorCreate = jest.fn();
const mockVersionCreate = jest.fn();
const mockValidarLocations = jest.fn();
const mockValidarEncounterTypes = jest.fn();
const mockValidarDiagnosticos = jest.fn();

jest.mock("../src/models/indicador.js", () => ({
  Indicador: {
    create: (...args: unknown[]) => mockIndicadorCreate(...args),
  },
  IndicadorVersion: {
    create: (...args: unknown[]) => mockVersionCreate(...args),
  },
  IndicadorResultado: {},
}));

jest.mock("../src/validators/openmrs.js", () => ({
  validarDefinicionLocationUuids: (...args: unknown[]) =>
    mockValidarLocations(...args),
  validarDefinicionEncounterTypeUuids: (...args: unknown[]) =>
    mockValidarEncounterTypes(...args),
  validarDefinicionDiagnosticoUuids: (...args: unknown[]) =>
    mockValidarDiagnosticos(...args),
}));

import {
  createIndicatorWithVersion,
  createIndicatorVersion,
  InvalidDefinitionError,
  parseRegistrationDefinition,
  PeriodRejectedError,
  UnknownUuidsError,
  validateRegistrationUuids,
} from "../src/indicators/registration.js";
import { parseDefinicionIndicador } from "../src/types/definicion.js";

beforeEach(() => {
  jest.clearAllMocks();
  mockValidarLocations.mockResolvedValue([]);
  mockValidarEncounterTypes.mockResolvedValue([]);
  mockValidarDiagnosticos.mockResolvedValue([]);
});

describe("parseRegistrationDefinition", () => {
  test("rejects legacy periodo with field-preserving error", () => {
    const err = (() => {
      try {
        parseRegistrationDefinition({
          tipo: "conteo_atenciones",
          periodo: "mes_actual",
        });
      } catch (e: unknown) {
        return e;
      }
      throw new Error("should have thrown");
    })();

    expect(err).toBeInstanceOf(PeriodRejectedError);
    expect((err as PeriodRejectedError).field).toBe("definicion.periodo");
  });

  test("wraps shape errors preserving the zod message", () => {
    const err = (() => {
      try {
        parseRegistrationDefinition({ tipo: "invalido" });
      } catch (e: unknown) {
        return e;
      }
      throw new Error("should have thrown");
    })();

    expect(err).toBeInstanceOf(InvalidDefinitionError);
    expect((err as InvalidDefinitionError).field).toBe("definicion");
    expect((err as Error).message).toContain("conteo_atenciones");
  });
});

describe("validateRegistrationUuids", () => {
  test("passes when every validator returns []", async () => {
    const definicion = parseDefinicionIndicador({ tipo: "conteo_atenciones" });

    await expect(validateRegistrationUuids(definicion)).resolves.toBeUndefined();
    expect(mockValidarLocations).toHaveBeenCalledTimes(1);
    expect(mockValidarEncounterTypes).toHaveBeenCalledTimes(1);
    expect(mockValidarDiagnosticos).toHaveBeenCalledTimes(1);
  });

  test("reports the first offending field (locations before diagnosticos)", async () => {
    mockValidarLocations.mockResolvedValueOnce(["bad-loc"]);
    mockValidarDiagnosticos.mockResolvedValueOnce(["bad-diag"]);
    const definicion = parseDefinicionIndicador({ tipo: "conteo_atenciones" });

    const err = await validateRegistrationUuids(definicion).catch((e) => e);

    expect(err).toBeInstanceOf(UnknownUuidsError);
    expect((err as UnknownUuidsError).field).toBe("location_uuids");
    expect((err as UnknownUuidsError).unknown_uuids).toEqual(["bad-loc"]);
    // Short-circuit: later validators never run.
    expect(mockValidarDiagnosticos).not.toHaveBeenCalled();
  });
});

describe("createIndicatorWithVersion", () => {
  test("persists indicador + version 1 with explicit ids", async () => {
    mockIndicadorCreate.mockImplementation(async (values: unknown) => ({
      id: (values as { id: string }).id,
    }));
    mockVersionCreate.mockResolvedValue({ id: "v-1" });
    const definicion = parseDefinicionIndicador({ tipo: "conteo_atenciones" });

    const { indicador } = await createIndicatorWithVersion({
      nombre: "Test",
      descripcion: null,
      activo: true,
      definicion,
    });

    expect(mockIndicadorCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        id: expect.any(String),
        nombre: "Test",
        activo: true,
      }),
    );
    expect(mockVersionCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        id: expect.any(String),
        indicador_id: indicador.id,
        version: 1,
        definicion: expect.objectContaining({ tipo: "conteo_atenciones" }),
      }),
    );
  });
});

describe("createIndicatorVersion", () => {
  test("persists the requested version number", async () => {
    mockVersionCreate.mockResolvedValue({ id: "v-1" });
    const definicion = parseDefinicionIndicador({ tipo: "conteo_pacientes" });

    await createIndicatorVersion("ind-1", 1, definicion);

    expect(mockVersionCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        indicador_id: "ind-1",
        version: 1,
      }),
    );
  });
});
