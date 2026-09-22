/**
 * Tests for src/validators/openmrs.ts
 *
 * Coverage target: validarLocations, validarDefinicionLocationUuids,
 * resolveConceptMap and the OpenMRSUnavailableError sentinel.
 *
 * queryMysql is mocked so the tests never touch a real MySQL/OpenMRS
 * instance. Each test asserts both the returned value and the SQL/params
 * shape that was forwarded to queryMysql, to catch regressions that
 * silently change the query contract (placeholders, retired filter,
 * empty-input short-circuit).
 */

import { jest } from "@jest/globals";

const mockQueryMysql = jest.fn();

jest.mock("../src/database/mysql.js", () => ({
  queryMysql: (...args: unknown[]) => mockQueryMysql(...args),
}));

import {
  OpenMRSUnavailableError,
  validarLocations,
  validarDefinicionLocationUuids,
  validarEncounterTypes,
  validarDefinicionEncounterTypeUuids,
  resolveConceptMap,
} from "../src/validators/openmrs.js";
import type { DefinicionIndicador } from "../src/types/definicion.js";

const UUID1 = "11111111-1111-1111-1111-111111111111";
const UUID2 = "22222222-2222-2222-2222-222222222222";
const UUID3 = "33333333-3333-3333-3333-333333333333";

beforeEach(() => {
  jest.clearAllMocks();
});

describe("OpenMRSUnavailableError", () => {
  it("carries the expected name and message", () => {
    const err = new OpenMRSUnavailableError();
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(OpenMRSUnavailableError);
    expect(err.name).toBe("OpenMRSUnavailableError");
    expect(err.message).toBe("OpenMRS no disponible");
  });
});

describe("validarLocations", () => {
  it("returns [] without touching MySQL when the set is empty", async () => {
    const result = await validarLocations(new Set<string>());
    expect(result).toEqual([]);
    expect(mockQueryMysql).not.toHaveBeenCalled();
  });

  it("returns [] when every uuid exists in OpenMRS", async () => {
    mockQueryMysql.mockResolvedValueOnce([{ uuid: UUID1 }, { uuid: UUID2 }]);

    const result = await validarLocations(new Set([UUID1, UUID2]));

    expect(result).toEqual([]);
    expect(mockQueryMysql).toHaveBeenCalledTimes(1);
    const [sql, params] = mockQueryMysql.mock.calls[0];
    expect(sql).toContain("SELECT uuid FROM location");
    expect(sql).toContain("WHERE uuid IN");
    expect(params).toEqual({ uuid_0: UUID1, uuid_1: UUID2 });
  });

  it("returns the uuids not found in OpenMRS, preserving caller order", async () => {
    mockQueryMysql.mockResolvedValueOnce([{ uuid: UUID1 }]);

    const result = await validarLocations(new Set([UUID1, UUID2, UUID3]));

    expect(result).toEqual([UUID2, UUID3]);
  });

  it("deduplicates the uuid set before querying", async () => {
    mockQueryMysql.mockResolvedValueOnce([{ uuid: UUID1 }]);

    await validarLocations(new Set([UUID1, UUID1]));

    const [, params] = mockQueryMysql.mock.calls[0];
    expect(Object.keys(params)).toEqual(["uuid_0"]);
    expect(params).toEqual({ uuid_0: UUID1 });
  });

  it("throws OpenMRSUnavailableError when MySQL rejects", async () => {
    mockQueryMysql.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    await expect(validarLocations(new Set([UUID1]))).rejects.toThrow(OpenMRSUnavailableError);
  });

  it("throws OpenMRSUnavailableError on non-Error rejection too", async () => {
    mockQueryMysql.mockRejectedValueOnce("a string, not an Error");

    await expect(validarLocations(new Set([UUID1]))).rejects.toThrow(OpenMRSUnavailableError);
  });
});

describe("validarDefinicionLocationUuids", () => {
  function makeDefinicion(locationUuids: string[] | undefined): DefinicionIndicador {
    return {
      tipo: "conteo_atenciones",
      evento: locationUuids ? { location_uuids: locationUuids } : undefined,
    } as unknown as DefinicionIndicador;
  }

  it("delegates to validarLocations with the union of evento.location_uuids", async () => {
    mockQueryMysql.mockResolvedValueOnce([{ uuid: UUID1 }, { uuid: UUID2 }]);

    const result = await validarDefinicionLocationUuids(
      makeDefinicion([UUID1, UUID2, UUID1]),
    );

    expect(result).toEqual([]);
    const [, params] = mockQueryMysql.mock.calls[0];
    // Set dedups UUID1 and orders deterministically per insertion.
    expect(Object.keys(params)).toEqual(["uuid_0", "uuid_1"]);
  });

  it("returns [] without calling MySQL when evento has no location_uuids", async () => {
    const result = await validarDefinicionLocationUuids(makeDefinicion(undefined));

    expect(result).toEqual([]);
    expect(mockQueryMysql).not.toHaveBeenCalled();
  });
});

describe("validarEncounterTypes", () => {
  it("returns [] without touching MySQL when the set is empty", async () => {
    const result = await validarEncounterTypes(new Set<string>());
    expect(result).toEqual([]);
    expect(mockQueryMysql).not.toHaveBeenCalled();
  });

  it("returns [] when every uuid exists in OpenMRS", async () => {
    mockQueryMysql.mockResolvedValueOnce([{ uuid: UUID1 }, { uuid: UUID2 }]);

    const result = await validarEncounterTypes(new Set([UUID1, UUID2]));

    expect(result).toEqual([]);
    expect(mockQueryMysql).toHaveBeenCalledTimes(1);
    const [sql, params] = mockQueryMysql.mock.calls[0];
    expect(sql).toContain("SELECT uuid FROM encounter_type");
    expect(sql).toContain("WHERE uuid IN");
    expect(sql).toContain("retired = 0");
    expect(params).toEqual({ uuid_0: UUID1, uuid_1: UUID2 });
  });

  it("returns the uuids not found in OpenMRS, preserving caller order", async () => {
    mockQueryMysql.mockResolvedValueOnce([{ uuid: UUID1 }]);

    const result = await validarEncounterTypes(new Set([UUID1, UUID2, UUID3]));

    expect(result).toEqual([UUID2, UUID3]);
  });

  it("throws OpenMRSUnavailableError when MySQL rejects", async () => {
    mockQueryMysql.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    await expect(validarEncounterTypes(new Set([UUID1]))).rejects.toThrow(
      OpenMRSUnavailableError,
    );
  });
});

describe("validarDefinicionEncounterTypeUuids", () => {
  function makeDefinicion(
    encounterTypeUuids: string[] | undefined,
  ): DefinicionIndicador {
    return {
      tipo: "conteo_pacientes_ventana",
      evento: encounterTypeUuids
        ? { encounter_type_uuids: encounterTypeUuids }
        : undefined,
    } as unknown as DefinicionIndicador;
  }

  it("delegates to validarEncounterTypes with the union of evento.encounter_type_uuids", async () => {
    mockQueryMysql.mockResolvedValueOnce([{ uuid: UUID1 }, { uuid: UUID2 }]);

    const result = await validarDefinicionEncounterTypeUuids(
      makeDefinicion([UUID1, UUID2, UUID1]),
    );

    expect(result).toEqual([]);
    const [, params] = mockQueryMysql.mock.calls[0];
    // Set dedups UUID1 and orders deterministically per insertion.
    expect(Object.keys(params)).toEqual(["uuid_0", "uuid_1"]);
  });

  it("returns [] without calling MySQL when evento has no encounter_type_uuids", async () => {
    const result = await validarDefinicionEncounterTypeUuids(
      makeDefinicion(undefined),
    );

    expect(result).toEqual([]);
    expect(mockQueryMysql).not.toHaveBeenCalled();
  });
});

describe("resolveConceptMap", () => {
  it("returns {} without touching MySQL when the input is empty", async () => {
    const result = await resolveConceptMap([]);
    expect(result).toEqual({});
    expect(mockQueryMysql).not.toHaveBeenCalled();
  });

  it("maps uuid -> concept_id from OpenMRS rows, filtering retired concepts", async () => {
    mockQueryMysql.mockResolvedValueOnce([
      { uuid: UUID1, concept_id: 100 },
      { uuid: UUID2, concept_id: 200 },
    ]);

    const result = await resolveConceptMap([UUID1, UUID2]);

    expect(result).toEqual({ [UUID1]: 100, [UUID2]: 200 });
    expect(mockQueryMysql).toHaveBeenCalledTimes(1);
    const [sql, params] = mockQueryMysql.mock.calls[0];
    expect(sql).toContain("SELECT uuid, concept_id FROM concept");
    expect(sql).toContain("WHERE uuid IN");
    expect(sql).toContain("retired = 0");
    expect(params).toEqual({ uuid_0: UUID1, uuid_1: UUID2 });
  });

  it("returns a partial map when only some uuids are found", async () => {
    mockQueryMysql.mockResolvedValueOnce([{ uuid: UUID2, concept_id: 7 }]);

    const result = await resolveConceptMap([UUID1, UUID2]);

    expect(result).toEqual({ [UUID2]: 7 });
  });

  it("throws OpenMRSUnavailableError when MySQL rejects", async () => {
    mockQueryMysql.mockRejectedValueOnce(new Error("connection lost"));

    await expect(resolveConceptMap([UUID1])).rejects.toThrow(OpenMRSUnavailableError);
  });
});