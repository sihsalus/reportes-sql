/**
 * Shared domain errors.
 *
 * Centralized error types used across database/validator/router layers so
 * any module can raise a domain error without creating import cycles
 * (e.g. `database/mysql.ts` -> `validators/openmrs.ts` would be circular
 * because `validators/openmrs.ts` imports `queryMysql`).
 */

/**
 * Raised when the OpenMRS MySQL database cannot be reached, when a query
 * times out, or when the connection pool is exhausted.
 *
 * Routers map this to HTTP 502 (fail-closed): the OpenMRS backend is the
 * source of truth for clinical data and we never serve partial/stale
 * results when it is unavailable.
 */
export class OpenMRSUnavailableError extends Error {
  constructor() {
    super("OpenMRS no disponible");
    this.name = "OpenMRSUnavailableError";
  }
}