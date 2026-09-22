/**
 * MySQL connection pool (mysql2) — OpenMRS read-only.
 *
 * Direct mysql2 pool for raw SQL execution against the external OpenMRS
 * database. This pool is for READS only — never use it for writes.
 */

import mysql from "mysql2/promise";
import { settings } from "../config/index.js";
import { logger } from "../config/logger.js";
import { OpenMRSUnavailableError } from "../errors.js";

let pool: mysql.Pool | null = null;

/**
 * Return the mysql2 connection pool, creating it on first call.
 *
 * Pool options are set explicitly (A-1) so a stuck/slow OpenMRS database
 * fails fast instead of exhausting the pool and hanging the whole service:
 * - `connectTimeout`: TCP connect handshake ceiling (10s default).
 * - `queueLimit`: bounded acquire queue (50) — beyond it mysql2 rejects
 *   with an error that `queryMysql` maps to `OpenMRSUnavailableError`.
 * - mysql2 does not expose `acquireTimeout` in PoolOptions; queryMysql
 *   enforces the acquire timeout around `getConnection`.
 *
 * Per-query timeout is wired inside `queryMysql` with a real timer. On
 * timeout, the active connection is destroyed so a running query cannot
 * continue occupying a pool slot.
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
      queueLimit: 50,
      connectTimeout: settings.openmrs_db_connect_timeout_ms,
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
 * Typed wrapper around a mysql2 pool connection with namedPlaceholders and a
 * per-query timeout.
 *
 * Any pool acquisition failure, connection error, or query timeout is
 * mapped to `OpenMRSUnavailableError` so routers can uniformly translate
 * upstream outages into HTTP 502. The raw error message is logged before
 * re-raising so the underlying cause (host:port, ECONNREFUSED, timeout,
 * pool-exhausted) stays available to operators without leaking to clients.
 */
export async function queryMysql<T>(
  sql: string,
  params: Record<string, unknown>,
): Promise<T[]> {
  const p = getMysqlPool();
  let connection: mysql.PoolConnection | null = null;
  let connectionTimedOut = false;
  let connectionDestroyed = false;

  const destroyConnection = (): void => {
    if (connection !== null && !connectionDestroyed) {
      connectionDestroyed = true;
      connection.destroy();
    }
  };

  const timeoutError = (kind: "acquire" | "query"): Error => {
    const error = new Error(`MySQL ${kind} timeout`);
    error.name = "MySQLTimeoutError";
    return error;
  };

  const withTimeout = async <R>(
    promise: Promise<R>,
    timeoutMs: number,
    onTimeout: () => void,
    kind: "acquire" | "query",
  ): Promise<R> => {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await new Promise<R>((resolve, reject) => {
        timer = setTimeout(() => {
          onTimeout();
          reject(timeoutError(kind));
        }, timeoutMs);
        promise.then(resolve, reject);
      });
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  };

  try {
    const acquirePromise = p.getConnection();
    // If acquire resolves after its timeout, destroy the late connection so
    // it cannot leak an occupied slot into the pool.
    acquirePromise.then((lateConnection) => {
      if (connectionTimedOut) lateConnection.destroy();
    }).catch(() => undefined);
    connection = await withTimeout(
      acquirePromise,
      settings.openmrs_db_acquire_timeout_ms,
      () => {
        connectionTimedOut = true;
      },
      "acquire",
    );

    // mysql2's typings don't expose `namedPlaceholders` on the connection
    // query object form, even though the option is required at runtime when
    // the pool is configured with named placeholders.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const queryPromise = (connection as any).query({
      sql,
      namedPlaceholders: true,
      values: params,
    }) as Promise<[unknown, unknown]>;
    const [rows] = await withTimeout(
      queryPromise,
      settings.openmrs_db_query_timeout_ms,
      () => {
        connectionTimedOut = true;
        destroyConnection();
      },
      "query",
    );
    return rows as T[];
  } catch (err) {
    const detail =
      err instanceof Error
        ? `${err.name}: ${err.message}`
        : String(err);
    logger.error(
      `[mysql] query fallida — mapeando a OpenMRSUnavailableError. ` +
      `Motivo: ${detail}.`,
    );
    throw new OpenMRSUnavailableError();
  } finally {
    if (connection !== null) {
      if (connectionTimedOut) destroyConnection();
      else connection.release();
    }
  }
}
