/**
 * Application configuration via dotenv.
 *
 * All database and API connection parameters are loaded from environment
 * variables and typed. Individual host/port/name/user/password vars are used
 * instead of monolithic DSN strings to keep configuration granular.
 */

import dotenv from "dotenv";
import { logger } from "./logger.js";

dotenv.config();

export interface Settings {
  // PostgreSQL: Indicators database (read/write)
  indicators_db_host: string;
  indicators_db_port: number;
  indicators_db_name: string;
  indicators_db_user: string;
  indicators_db_password: string;

  // MySQL: OpenMRS database (read-only)
  openmrs_db_host: string;
  openmrs_db_port: number;
  openmrs_db_name: string;
  openmrs_db_user: string;
  openmrs_db_password: string;
  // Fail-fast timeouts for the OpenMRS MySQL pool (ms).
  // See A-1: unbounded waits saturate the pool and hang the service.
  // - connect: TCP handshake ceiling (mysql2 `connectTimeout`).
  // - acquire: time waiting for a free connection. mysql2 does not expose
  //   `acquireTimeout` in PoolOptions, so queryMysql enforces this manually.
  // - query: per-query execution ceiling.
  openmrs_db_connect_timeout_ms: number;
  openmrs_db_acquire_timeout_ms: number;
  openmrs_db_query_timeout_ms: number;

  // OpenMRS REST API
  openmrs_api_url: string;

  // Application
  port: number;
  auto_register_catalog: boolean;

  // Scheduled recalculation
  recalc_hour: number;
  recalc_window_months: number;

  // Routing
  base_path: string;
}

function parsePort(value: string | undefined, fallback: number): number {
  if (value === undefined || value === "") return fallback;
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? fallback : parsed;
}

/**
 * Parse a positive integer env var (typically a millisecond timeout).
 * Falls back to `fallback` when unset, empty, or non-numeric. Negative or
 * zero values are rejected too: a timeout of 0 would disable the limit,
 * reintroducing the A-1 saturation risk we are guarding against.
 */
function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (value === undefined || value === "") return fallback;
  const parsed = parseInt(value, 10);
  if (isNaN(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === "") return fallback;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

/**
 * Parse an integer env var within an inclusive range. Falls back when unset,
 * empty, non-numeric, or out of range. Used for the scheduled-recalculation
 * day (1-28) and hour (0-23), so a bad value never silently disables the run
 * or fires on an impossible date.
 */
function parseIntInRange(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (value === undefined || value === "") return fallback;
  const parsed = parseInt(value, 10);
  if (isNaN(parsed) || parsed < min || parsed > max) return fallback;
  return parsed;
}

/**
 * Normalize BASE_PATH to a safe mount prefix.
 *
 * - Empty or undefined → "" (no prefix)
 * - Non-empty → ensure leading "/", strip trailing "/"
 */
export function normalizeBasePath(value: string | undefined): string {
  if (!value) return "";
  const trimmed = value.trim();
  if (trimmed === "") return "";
  // Ensure leading slash
  let path = trimmed.startsWith("/") ? trimmed : "/" + trimmed;
  // Strip trailing slash (preserve "/" as-is)
  if (path.length > 1 && path.endsWith("/")) {
    path = path.slice(0, -1);
  }
  return path;
}

/**
 * Read an env var, trying a primary name first, then a legacy alias.
 * Returns undefined if neither is set.
 */
function envEither(primary: string, alias: string): string | undefined {
  return process.env[primary] ?? process.env[alias];
}

export const settings: Settings = {
  indicators_db_host: envEither("INDICATORS_DB_HOST", "INDICADORES_DB_HOST") ?? "localhost",
  indicators_db_port: parsePort(envEither("INDICATORS_DB_PORT", "INDICADORES_DB_PORT"), 5432),
  indicators_db_name: envEither("INDICATORS_DB_NAME", "INDICADORES_DB_NAME") ?? "indicators",
  indicators_db_user: envEither("INDICATORS_DB_USER", "INDICADORES_DB_USER") ?? "postgres",
  indicators_db_password: envEither("INDICATORS_DB_PASSWORD", "INDICADORES_DB_PASSWORD") ?? "postgres",

  openmrs_db_host: process.env["OPENMRS_DB_HOST"] ?? "localhost",
  openmrs_db_port: parsePort(process.env["OPENMRS_DB_PORT"], 3306),
  openmrs_db_name: process.env["OPENMRS_DB_NAME"] ?? "openmrs",
  openmrs_db_user: process.env["OPENMRS_DB_USER"] ?? "openmrs",
  openmrs_db_password: process.env["OPENMRS_DB_PASSWORD"] ?? "openmrs",
  // Fail-fast MySQL pool timeouts (ms). mysql2 has no PoolOptions
  // `acquireTimeout`, so queryMysql applies this acquire timeout around
  // getConnection. `queueLimit` also rejects when the acquire queue overflows.
  openmrs_db_connect_timeout_ms: parsePositiveInt(
    process.env["OPENMRS_DB_CONNECT_TIMEOUT_MS"],
    10_000,
  ),
  openmrs_db_acquire_timeout_ms: parsePositiveInt(
    process.env["OPENMRS_DB_ACQUIRE_TIMEOUT_MS"],
    10_000,
  ),
  openmrs_db_query_timeout_ms: parsePositiveInt(
    process.env["OPENMRS_DB_QUERY_TIMEOUT_MS"],
    30_000,
  ),

  openmrs_api_url: process.env["OPENMRS_API_URL"] ?? "http://localhost/openmrs",

  port: parsePort(process.env["PORT"], 8000),
  auto_register_catalog: parseBoolean(
    process.env["AUTO_REGISTER_CATALOG"],
    true,
  ),

  recalc_hour: parseIntInRange(process.env["RECALC_HOUR"], 2, 0, 23),
  // Rolling window of months to recalculate each nightly run: the current
  // month plus this many minus one previous ones (to absorb late data entry).
  recalc_window_months: parseIntInRange(
    envEither("RECALC_WINDOW_MONTHS", "RECALC_VENTANA_MESES"),
    3,
    1,
    24,
  ),

  base_path: normalizeBasePath(process.env["BASE_PATH"]),
};

/** PostgreSQL connection URL for Sequelize */
export function getIndicadoresDatabaseUrl(): string {
  return `postgres://${settings.indicators_db_user}:${encodeURIComponent(settings.indicators_db_password)}@${settings.indicators_db_host}:${settings.indicators_db_port}/${settings.indicators_db_name}`;
}

/**
 * Log warnings for any credential that is using its hardcoded default.
 * Called once at startup to surface misconfigured production deployments.
 */
export function warnDefaultCredentials(): void {
  const checks = [
    "INDICATORS_DB_PASSWORD",
    "OPENMRS_DB_PASSWORD",
  ];

  for (const env of checks) {
    if (!process.env[env]) {
      logger.warn(
        `[config] ${env} no está definida — usando valor por defecto. ` +
        `En producción, definila explícitamente.`,
      );
    }
  }
}
