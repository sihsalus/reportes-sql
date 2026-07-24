/**
 * Unit tests for src/config/index.ts
 *
 * Covers parseCorsOrigins, normalizeBasePath, warnDefaultCredentials, and
 * getIndicadoresDatabaseUrl. Uses jest.resetModules() + dynamic import for
 * env-dependent parts.
 */
import { jest } from "@jest/globals";

// Static import for env-independent pure functions
import {
  parseCorsOrigins,
  normalizeBasePath,
} from "../src/config/index.js";

// ── Pure functions (safe to import statically) ─────────────────────────────

describe("parseCorsOrigins", () => {
  test("returns defaults when value is undefined", () => {
    const result = parseCorsOrigins(undefined);
    expect(result).toContain("http://localhost:5173");
    expect(result).toContain("http://127.0.0.1:8080");
    expect(result.length).toBe(4);
  });

  test("returns defaults when value is empty string", () => {
    expect(parseCorsOrigins("")).toHaveLength(4);
  });

  test("returns defaults when value is whitespace only", () => {
    expect(parseCorsOrigins("   ")).toHaveLength(4);
  });

  test("parses single origin", () => {
    expect(parseCorsOrigins("https://example.com")).toEqual([
      "https://example.com",
    ]);
  });

  test("parses comma-separated origins, trimming whitespace", () => {
    expect(
      parseCorsOrigins("https://a.com, https://b.com ,  https://c.com"),
    ).toEqual(["https://a.com", "https://b.com", "https://c.com"]);
  });

  test("filters out empty segments", () => {
    expect(parseCorsOrigins("https://a.com,,https://b.com")).toEqual([
      "https://a.com",
      "https://b.com",
    ]);
  });
});

describe("normalizeBasePath", () => {
  test("empty string returns empty", () => {
    expect(normalizeBasePath("")).toBe("");
  });

  test("undefined returns empty", () => {
    expect(normalizeBasePath(undefined)).toBe("");
  });

  test("single slash preserved", () => {
    expect(normalizeBasePath("/")).toBe("/");
  });

  test("strips trailing slash", () => {
    expect(normalizeBasePath("/api/")).toBe("/api");
  });

  test("adds leading slash when missing", () => {
    expect(normalizeBasePath("api")).toBe("/api");
  });

  test("adds leading and strips trailing", () => {
    expect(normalizeBasePath("api/v2/")).toBe("/api/v2");
  });

  test("preserves already-correct path", () => {
    expect(normalizeBasePath("/api/v2")).toBe("/api/v2");
  });

  test("whitespace-only returns empty", () => {
    expect(normalizeBasePath("   ")).toBe("");
  });
});

// ── Env-dependent functions (dynamic import) ───────────────────────────────

async function importConfigFresh() {
  jest.resetModules();
  return await import("../src/config/index.js");
}

beforeEach(() => {
  // Suppress logger output during warnDefaultCredentials
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
  jest.spyOn(console, "info").mockImplementation(() => {});
  jest.spyOn(console, "debug").mockImplementation(() => {});
  // Clear relevant env vars
  delete process.env["INDICATORS_DB_PASSWORD"];
  delete process.env["INDICADORES_DB_PASSWORD"];
  delete process.env["OPENMRS_DB_PASSWORD"];
  delete process.env["OPENMRS_API_PASSWORD"];
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("warnDefaultCredentials", () => {
  test("warns when INDICATORS_DB_PASSWORD is unset", async () => {
    const c = jest.spyOn(console, "warn").mockImplementation(() => {});
    const { warnDefaultCredentials } = await importConfigFresh();

    warnDefaultCredentials();

    expect(c).toHaveBeenCalledWith(
      expect.stringContaining("INDICATORS_DB_PASSWORD"),
    );
    c.mockRestore();
  });

  test("warns when OPENMRS_DB_PASSWORD is unset", async () => {
    process.env["INDICATORS_DB_PASSWORD"] = "not-default";
    const c = jest.spyOn(console, "warn").mockImplementation(() => {});
    const { warnDefaultCredentials } = await importConfigFresh();

    warnDefaultCredentials();

    // Should warn about OPENMRS and API passwords (both unset)
    expect(c).toHaveBeenCalledWith(
      expect.stringContaining("OPENMRS_DB_PASSWORD"),
    );
    c.mockRestore();
  });

  test("does not warn when all passwords are set", async () => {
    process.env["INDICATORS_DB_PASSWORD"] = "s3cret";
    process.env["OPENMRS_DB_PASSWORD"] = "s3cret";
    process.env["OPENMRS_API_PASSWORD"] = "s3cret";
    const c = jest.spyOn(console, "warn").mockImplementation(() => {});
    const { warnDefaultCredentials } = await importConfigFresh();

    warnDefaultCredentials();

    expect(c).not.toHaveBeenCalled();
    c.mockRestore();
  });

  test("uses INDICATORS_DB_PASSWORD (canonical) over INDICADORES_DB_PASSWORD (legacy)", async () => {
    // Set the canonical var — no warning expected for indicators password
    process.env["INDICATORS_DB_PASSWORD"] = "canonical-secret";
    process.env["OPENMRS_DB_PASSWORD"] = "openmrs-secret";
    const c = jest.spyOn(console, "warn").mockImplementation(() => {});
    const { warnDefaultCredentials } = await importConfigFresh();

    warnDefaultCredentials();

    // Should warn only about OPENMRS_API_PASSWORD (still unset)
    const calls = c.mock.calls.map((call) => call[0] as string);
    expect(calls.some((line) => line.includes("INDICATORS_DB_PASSWORD"))).toBe(false);
    expect(calls.some((line) => line.includes("OPENMRS_API_PASSWORD"))).toBe(true);
    c.mockRestore();
  });
});

describe("getIndicadoresDatabaseUrl", () => {
  test("builds URL with default values", async () => {
    const { getIndicadoresDatabaseUrl } = await importConfigFresh();
    const url = getIndicadoresDatabaseUrl();
    expect(url).toBe(
      "postgres://postgres:postgres@localhost:5432/indicators",
    );
  });

  test("builds URL with custom values", async () => {
    process.env["INDICATORS_DB_HOST"] = "pg.example.com";
    process.env["INDICATORS_DB_PORT"] = "5433";
    process.env["INDICATORS_DB_NAME"] = "my_indicators";
    process.env["INDICATORS_DB_USER"] = "admin";
    process.env["INDICATORS_DB_PASSWORD"] = "p@ss!w0rd";
    const { getIndicadoresDatabaseUrl } = await importConfigFresh();

    const url = getIndicadoresDatabaseUrl();
    // encodeURIComponent encodes @ → %40 but leaves ! unencoded
    expect(url).toBe(
      "postgres://admin:p%40ss!w0rd@pg.example.com:5433/my_indicators",
    );
  });

  test("falls back to INDICADORES_DB_PASSWORD legacy alias", async () => {
    delete process.env["INDICATORS_DB_PASSWORD"];
    process.env["INDICADORES_DB_PASSWORD"] = "legacy-pass";
    const { getIndicadoresDatabaseUrl } = await importConfigFresh();

    const url = getIndicadoresDatabaseUrl();
    expect(url).toContain("legacy-pass");
  });
});
