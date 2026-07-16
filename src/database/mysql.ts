/**
 * MySQL connection pool (mysql2) — OpenMRS read-only.
 *
 * Direct mysql2 pool for raw SQL execution against the external OpenMRS
 * database. This pool is for READS only — never use it for writes.
 */

import mysql from "mysql2/promise";
import { settings } from "../config/index.js";

let pool: mysql.Pool | null = null;

/**
 * Return the mysql2 connection pool, creating it on first call.
 */
export function getMysqlPool(): mysql.Pool {
  if (pool === null) {
    pool = mysql.createPool({
      host: settings.openmrs_db_host,
      port: settings.openmrs_db_port,
      database: settings.openmrs_db_name,
      user: settings.openmrs_db_user,
      password: settings.openmrs_db_password,
      connectionLimit: 5,
      waitForConnections: true,
      queueLimit: 0,
      enableKeepAlive: true,
      keepAliveInitialDelay: 0,
      namedPlaceholders: true, // Enable :name parameter syntax
    });
  }
  return pool;
}

/**
 * Dispose the mysql2 connection pool on shutdown.
 */
export async function disposeMysql(): Promise<void> {
  if (pool !== null) {
    await pool.end();
    pool = null;
  }
}

/**
 * Typed wrapper around mysql2 pool.query() with namedPlaceholders.
 *
 * Avoids `(pool as any).query(...)` casts in callers while preserving the
 * object-style call signature that `namedPlaceholders: true` requires.
 */
export async function queryMysql<T>(
  sql: string,
  params: Record<string, unknown>,
): Promise<T[]> {
  const p = getMysqlPool();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [rows] = await (p as any).query({
    sql,
    namedPlaceholders: true,
    values: params,
  });
  return rows as T[];
}
