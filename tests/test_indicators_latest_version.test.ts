/**
 * Unit tests for src/indicators/latest-version.ts — the shared
 * "latest version of an indicator" lookup.
 */
import { jest } from "@jest/globals";

const mockQuery = jest.fn();

jest.mock("../src/database/postgres.js", () => ({
  sequelize: {
    query: (...args: unknown[]) => mockQuery(...args),
  },
}));

import {
  findLatestVersion,
  findLatestVersions,
} from "../src/indicators/latest-version.js";

beforeEach(() => {
  jest.clearAllMocks();
  mockQuery.mockResolvedValue([]);
});

describe("findLatestVersion", () => {
  test("returns the newest version with its definition", async () => {
    const row = {
      id: "version-2",
      version: 2,
      definicion: { tipo: "conteo_pacientes" },
    };
    mockQuery.mockResolvedValue([row]);

    await expect(findLatestVersion("ind-1", false)).resolves.toEqual(row);
  });

  test("returns null when the indicator has no versions", async () => {
    await expect(findLatestVersion("ind-1", false)).resolves.toBeNull();
  });

  test("filters out versions of deactivated indicators when required", async () => {
    await findLatestVersion("ind-1", true);

    const [sql, opts] = mockQuery.mock.calls[0] as [string, Record<string, unknown>];
    expect(sql).toContain("i.activo = true");
    expect(sql).toContain("ORDER BY iv.version DESC");
    expect(sql).toContain("LIMIT 1");
    expect(opts).toMatchObject({
      replacements: { indicador_id: "ind-1" },
    });
  });

  test("omits the active filter when not required", async () => {
    await findLatestVersion("ind-1", false);

    const [sql] = mockQuery.mock.calls[0] as [string];
    expect(sql).not.toContain("i.activo = true");
  });
});

describe("findLatestVersions", () => {
  test("skips the query entirely when no ids are given", async () => {
    const result = await findLatestVersions([]);

    expect(result.size).toBe(0);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test("keys the latest version per indicator from one DISTINCT ON query", async () => {
    mockQuery.mockResolvedValue([
      { id: "v1", indicador_id: "ind-1", version: 1, definicion: {} },
      { id: "v2", indicador_id: "ind-2", version: 3, definicion: {} },
    ]);

    const result = await findLatestVersions(["ind-1", "ind-2"]);

    expect(result.get("ind-1")?.id).toBe("v1");
    expect(result.get("ind-2")?.version).toBe(3);
    const [sql, opts] = mockQuery.mock.calls[0] as [string, Record<string, unknown>];
    expect(sql).toContain("DISTINCT ON (iv.indicador_id)");
    expect(opts).toMatchObject({
      replacements: { indicador_ids: ["ind-1", "ind-2"] },
    });
  });
});
