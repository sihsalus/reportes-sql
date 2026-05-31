/**
 * Application configuration via dotenv.
 *
 * All database and API connection parameters are loaded from environment
 * variables and typed. Individual host/port/name/user/password vars are used
 * instead of monolithic DSN strings to keep configuration granular.
 */

import dotenv from "dotenv";

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
}

function parsePort(value: string | undefined, fallback: number): number {
  if (value === undefined || value === "") return fallback;
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? fallback : parsed;
}

export const settings: Settings = {
  indicadores_db_host: process.env["INDICADORES_DB_HOST"] ?? "localhost",
  indicadores_db_port: parsePort(process.env["INDICADORES_DB_PORT"], 5432),
  indicadores_db_name: process.env["INDICADORES_DB_NAME"] ?? "indicators",
  indicadores_db_user: process.env["INDICADORES_DB_USER"] ?? "postgres",
  indicadores_db_password:
    process.env["INDICADORES_DB_PASSWORD"] ?? "postgres",

  openmrs_db_host: process.env["OPENMRS_DB_HOST"] ?? "localhost",
  openmrs_db_port: parsePort(process.env["OPENMRS_DB_PORT"], 3306),
  openmrs_db_name: process.env["OPENMRS_DB_NAME"] ?? "openmrs",
  openmrs_db_user: process.env["OPENMRS_DB_USER"] ?? "openmrs",
  openmrs_db_password: process.env["OPENMRS_DB_PASSWORD"] ?? "openmrs",

  openmrs_api_url: process.env["OPENMRS_API_URL"] ?? "http://localhost/openmrs",
  openmrs_api_user: process.env["OPENMRS_API_USER"] ?? "admin",
  openmrs_api_password: process.env["OPENMRS_API_PASSWORD"] ?? "Admin123",

  port: parsePort(process.env["PORT"], 8000),
};

/** PostgreSQL connection URL for Sequelize */
export function getIndicadoresDatabaseUrl(): string {
  return `postgres://${settings.indicadores_db_user}:${encodeURIComponent(settings.indicadores_db_password)}@${settings.indicadores_db_host}:${settings.indicadores_db_port}/${settings.indicadores_db_name}`;
}
