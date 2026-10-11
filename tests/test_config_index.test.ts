/**
 * Unit tests for src/config/index.ts
 *
 * Covers normalizeBasePath, warnDefaultCredentials, and
 * getIndicadoresDatabaseUrl. Uses jest.resetModules() + dynamic import for
 * env-dependent parts.
 */
import { jest } from "@jest/globals";

// `src/config/index.ts` calls `dotenv.config()` at import time. Stub dotenv so
// these unit tests are hermetic: they must assert the code defaults and
// explicit process.env overrides, never a developer's local `.env`.
jest.mock("dotenv", () => {
  const config = () => ({ parsed: {} });
  return { __esModule: true, config, default: { config } };
});

// Static import for env-independent pure functions
import {
  normalizeBasePath,
} from "../src/config/index.js";

// ── Pure functions (safe to import statically) ─────────────────────────────

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
  // Clear relevant env vars so the defaults are asserted against a known
  // environment, never the developer's shell or local `.env`.
  delete process.env["INDICATORS_DB_HOST"];
  delete process.env["INDICADORES_DB_HOST"];
  delete process.env["INDICATORS_DB_PORT"];
  delete process.env["INDICADORES_DB_PORT"];
  delete process.env["INDICATORS_DB_NAME"];
  delete process.env["INDICADORES_DB_NAME"];
  delete process.env["INDICATORS_DB_USER"];
  delete process.env["INDICADORES_DB_USER"];
  delete process.env["INDICATORS_DB_PASSWORD"];
  delete process.env["INDICADORES_DB_PASSWORD"];
  delete process.env["OPENMRS_DB_HOST"];
  delete process.env["OPENMRS_DB_PORT"];
  delete process.env["OPENMRS_DB_NAME"];
  delete process.env["OPENMRS_DB_USER"];
  delete process.env["OPENMRS_DB_PASSWORD"];
  delete process.env["OPENMRS_DB_CONNECT_TIMEOUT_MS"];
  delete process.env["OPENMRS_DB_ACQUIRE_TIMEOUT_MS"];
  delete process.env["OPENMRS_DB_QUERY_TIMEOUT_MS"];
  delete process.env["RECALC_HOUR"];
  delete process.env["RECALC_WINDOW_MONTHS"];
  delete process.env["RECALC_VENTANA_MESES"];
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

    expect(c).toHaveBeenCalledWith(
      expect.stringContaining("OPENMRS_DB_PASSWORD"),
    );
    c.mockRestore();
  });

  test("warns for unset passwords without exposing default values", async () => {
    const c = jest.spyOn(console, "warn").mockImplementation(() => {});
    const { warnDefaultCredentials } = await importConfigFresh();

    warnDefaultCredentials();

    const calls = c.mock.calls.map((call) => call[0] as string);
    expect(calls).toHaveLength(2);
    expect(calls.some((line) => line.includes("INDICATORS_DB_PASSWORD"))).toBe(true);
    expect(calls.some((line) => line.includes("OPENMRS_DB_PASSWORD"))).toBe(true);
    for (const credential of ["postgres", "openmrs"]) {
      expect(calls.some((line) => line.includes(credential))).toBe(false);
    }
    c.mockRestore();
  });

  test("does not warn when all passwords are set", async () => {
    process.env["INDICATORS_DB_PASSWORD"] = "s3cret";
    process.env["OPENMRS_DB_PASSWORD"] = "s3cret";
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

    // Both passwords are set → nothing to warn about.
    const calls = c.mock.calls.map((call) => call[0] as string);
    expect(calls.some((line) => line.includes("INDICATORS_DB_PASSWORD"))).toBe(false);
    expect(c).not.toHaveBeenCalled();
    c.mockRestore();
  });
});

describe("OpenMRS MySQL timeouts", () => {
  test("uses conservative defaults", async () => {
    const { settings: freshSettings } = await importConfigFresh();

    expect(freshSettings.openmrs_db_connect_timeout_ms).toBe(10_000);
    expect(freshSettings.openmrs_db_acquire_timeout_ms).toBe(10_000);
    expect(freshSettings.openmrs_db_query_timeout_ms).toBe(30_000);
  });

  test("parses positive integer overrides", async () => {
    process.env["OPENMRS_DB_CONNECT_TIMEOUT_MS"] = "5000";
    process.env["OPENMRS_DB_ACQUIRE_TIMEOUT_MS"] = "7500";
    process.env["OPENMRS_DB_QUERY_TIMEOUT_MS"] = "60000";

    const { settings: freshSettings } = await importConfigFresh();

    expect(freshSettings.openmrs_db_connect_timeout_ms).toBe(5_000);
    expect(freshSettings.openmrs_db_acquire_timeout_ms).toBe(7_500);
    expect(freshSettings.openmrs_db_query_timeout_ms).toBe(60_000);
  });

  test("falls back when timeout overrides are invalid or non-positive", async () => {
    process.env["OPENMRS_DB_CONNECT_TIMEOUT_MS"] = "not-a-number";
    process.env["OPENMRS_DB_ACQUIRE_TIMEOUT_MS"] = "0";
    process.env["OPENMRS_DB_QUERY_TIMEOUT_MS"] = "-1";

    const { settings: freshSettings } = await importConfigFresh();

    expect(freshSettings.openmrs_db_connect_timeout_ms).toBe(10_000);
    expect(freshSettings.openmrs_db_acquire_timeout_ms).toBe(10_000);
    expect(freshSettings.openmrs_db_query_timeout_ms).toBe(30_000);
  });
});

describe("scheduled recalculation", () => {
  test("defaults: hour 2, window 3", async () => {
    const { settings: freshSettings } = await importConfigFresh();

    expect(freshSettings.recalc_hour).toBe(2);
    expect(freshSettings.recalc_window_months).toBe(3);
  });

  test("parses RECALC_HOUR / RECALC_WINDOW_MONTHS", async () => {
    process.env["RECALC_HOUR"] = "0";
    process.env["RECALC_WINDOW_MONTHS"] = "6";

    const { settings: freshSettings } = await importConfigFresh();

    expect(freshSettings.recalc_hour).toBe(0);
    expect(freshSettings.recalc_window_months).toBe(6);
  });

  test("honors the legacy RECALC_VENTANA_MESES alias", async () => {
    process.env["RECALC_VENTANA_MESES"] = "5";

    const { settings: freshSettings } = await importConfigFresh();

    expect(freshSettings.recalc_window_months).toBe(5);
  });

  test("falls back when values are invalid or out of range", async () => {
    process.env["RECALC_HOUR"] = "24";
    process.env["RECALC_WINDOW_MONTHS"] = "0";

    const { settings: freshSettings } = await importConfigFresh();

    expect(freshSettings.recalc_hour).toBe(2);
    expect(freshSettings.recalc_window_months).toBe(3);
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
