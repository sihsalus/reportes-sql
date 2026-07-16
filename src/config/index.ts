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
  indicadores_db_host: string;
  indicadores_db_port: number;
  indicadores_db_name: string;
  indicadores_db_user: string;
  indicadores_db_password: string;

  // MySQL: OpenMRS database (read-only)
  openmrs_db_host: string;
  openmrs_db_port: number;
  openmrs_db_name: string;
  openmrs_db_user: string;
  openmrs_db_password: string;

  // OpenMRS REST API
  openmrs_api_url: string;
  openmrs_api_user: string;
  openmrs_api_password: string;

  // Application
  port: number;
  auto_seed_default_indicator: boolean;
  cors_origins: string[];

  // Routing
  base_path: string;
}

function parsePort(value: string | undefined, fallback: number): number {
  if (value === undefined || value === "") return fallback;
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? fallback : parsed;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === "") return fallback;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

/**
 * Parse CORS_ORIGINS from a comma-separated environment variable.
 *
 * Defaults to the localhost origins used during development (Vite dev server
 * on 5173 and common gateway/SPA ports on 8080). In production, set this to
 * the production-facing origin(s) of the gateway or SPA.
 */
export function parseCorsOrigins(
  value: string | undefined,
): string[] {
  const DEFAULT_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:8080",
    "http://127.0.0.1:8080",
  ];
  if (!value || value.trim() === "") return DEFAULT_ORIGINS;
  return value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
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
  indicadores_db_host: envEither("INDICATORS_DB_HOST", "INDICADORES_DB_HOST") ?? "localhost",
  indicadores_db_port: parsePort(envEither("INDICATORS_DB_PORT", "INDICADORES_DB_PORT"), 5432),
  indicadores_db_name: envEither("INDICATORS_DB_NAME", "INDICADORES_DB_NAME") ?? "indicators",
  indicadores_db_user: envEither("INDICATORS_DB_USER", "INDICADORES_DB_USER") ?? "postgres",
  indicadores_db_password: envEither("INDICATORS_DB_PASSWORD", "INDICADORES_DB_PASSWORD") ?? "postgres",

  openmrs_db_host: process.env["OPENMRS_DB_HOST"] ?? "localhost",
  openmrs_db_port: parsePort(process.env["OPENMRS_DB_PORT"], 3306),
  openmrs_db_name: process.env["OPENMRS_DB_NAME"] ?? "openmrs",
  openmrs_db_user: process.env["OPENMRS_DB_USER"] ?? "openmrs",
  openmrs_db_password: process.env["OPENMRS_DB_PASSWORD"] ?? "openmrs",

  openmrs_api_url: process.env["OPENMRS_API_URL"] ?? "http://localhost/openmrs",
  openmrs_api_user: process.env["OPENMRS_API_USER"] ?? "admin",
  openmrs_api_password: process.env["OPENMRS_API_PASSWORD"] ?? "Admin123",

  port: parsePort(process.env["PORT"], 8000),
  auto_seed_default_indicator: parseBoolean(
    process.env["AUTO_SEED_DEFAULT_INDICATOR"],
    true,
  ),

  cors_origins: parseCorsOrigins(process.env["CORS_ORIGINS"]),

  base_path: normalizeBasePath(process.env["BASE_PATH"]),
};

/** PostgreSQL connection URL for Sequelize */
export function getIndicadoresDatabaseUrl(): string {
  return `postgres://${settings.indicadores_db_user}:${encodeURIComponent(settings.indicadores_db_password)}@${settings.indicadores_db_host}:${settings.indicadores_db_port}/${settings.indicadores_db_name}`;
}

/**
 * Log warnings for any credential that is using its hardcoded default.
 * Called once at startup to surface misconfigured production deployments.
 */
export function warnDefaultCredentials(): void {
  const checks: Array<{ env: string; defaultVal: string }> = [
    { env: "INDICATORS_DB_PASSWORD", defaultVal: "postgres" },
    { env: "OPENMRS_DB_PASSWORD", defaultVal: "openmrs" },
    { env: "OPENMRS_API_PASSWORD", defaultVal: "Admin123" },
  ];

  for (const { env, defaultVal } of checks) {
    if (!process.env[env]) {
      logger.warn(
        `[config] ${env} no está definida — usando valor por defecto (${defaultVal}). ` +
        `En producción, definila explícitamente.`,
      );
    }
  }
}
