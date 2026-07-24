/**
 * Unit tests for src/engine/concept-resolver.ts
 *
 * Covers resolveOrcenesConceptMap and resolveOrcenesConceptMapOrNull.
 * resolveConceptMap from validators/openmrs is mocked via jest.mock.
 */
import { jest } from "@jest/globals";
import type { FiltroOrden } from "../src/types/definicion.js";

const mockResolveConceptMap = jest.fn<
  (_uuids: string[]) => Promise<Record<string, number>>
>();

jest.mock("../src/validators/openmrs.js", () => ({
  resolveConceptMap: (...args: unknown[]) =>
    mockResolveConceptMap(...(args as [string[]])),
}));

import {
  resolveOrcenesConceptMap,
  resolveOrcenesConceptMapOrNull,
} from "../src/engine/concept-resolver.js";

function orden(...uuids: string[]): FiltroOrden[] {
  return uuids.map((uuid) => ({ concepto_uuid: uuid }));
}

beforeEach(() => {
  mockResolveConceptMap.mockReset();
});

describe("resolveOrcenesConceptMap", () => {
  test("returns null for null input", async () => {
    const result = await resolveOrcenesConceptMap(null);
    expect(result).toBeNull();
  });

  test("returns null for undefined input", async () => {
    const result = await resolveOrcenesConceptMap(undefined);
    expect(result).toBeNull();
  });

  test("returns null for empty array", async () => {
    const result = await resolveOrcenesConceptMap([]);
    expect(result).toBeNull();
  });

  test("resolves single concepto_uuid", async () => {
    mockResolveConceptMap.mockResolvedValue({ "uuid-a": 10 });

    const result = await resolveOrcenesConceptMap(orden("uuid-a"));

    expect(mockResolveConceptMap).toHaveBeenCalledWith(["uuid-a"]);
    expect(result).toEqual({ "uuid-a": 10 });
  });

  test("resolves multiple conceptos", async () => {
    mockResolveConceptMap.mockResolvedValue({
      "uuid-a": 1,
      "uuid-b": 2,
      "uuid-c": 3,
    });

    const result = await resolveOrcenesConceptMap(
      orden("uuid-a", "uuid-b", "uuid-c"),
    );

    expect(result).toEqual({ "uuid-a": 1, "uuid-b": 2, "uuid-c": 3 });
  });

  test("throws when any concepto is missing from the resolved map", async () => {
    mockResolveConceptMap.mockResolvedValue({ "uuid-a": 1 });

    await expect(
      resolveOrcenesConceptMap(orden("uuid-a", "uuid-b")),
    ).rejects.toThrow(/uuid-b/);
  });

  test("throws with all missing uuids in the message", async () => {
    mockResolveConceptMap.mockResolvedValue({});

    await expect(
      resolveOrcenesConceptMap(orden("uuid-x", "uuid-y")),
    ).rejects.toThrow("uuid-x, uuid-y");
  });
});

describe("resolveOrcenesConceptMapOrNull", () => {
  test("returns map on success", async () => {
    mockResolveConceptMap.mockResolvedValue({ "uuid-a": 42 });

    const result = await resolveOrcenesConceptMapOrNull(orden("uuid-a"));

    expect(result).toEqual({ "uuid-a": 42 });
  });

  test("returns null on missing conceptos instead of throwing", async () => {
    mockResolveConceptMap.mockResolvedValue({});

    const result = await resolveOrcenesConceptMapOrNull(orden("uuid-x"));

    expect(result).toBeNull();
  });

  test("returns null for null input", async () => {
    const result = await resolveOrcenesConceptMapOrNull(null);
    expect(result).toBeNull();
  });
});
