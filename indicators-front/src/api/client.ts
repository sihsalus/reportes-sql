/**
 * Typed fetch wrapper for the Motor de Indicadores REST API.
 *
 * Uses native `fetch` (zero dependencies). The Vite dev server proxies
 * API routes → `http://localhost:8000`, so requests are relative to origin.
 *
 * Errors are thrown as {@link ApiRequestError} with the parsed server detail.
 */

const API_BASE = '';

/** Thrown when the API returns a non-2xx response. */
export class ApiRequestError extends Error {
  detail: string;
  status: number;
  /** Raw parsed JSON body from the error response, preserved for inspection. */
  body: unknown;

  constructor(status: number, detail: string, body?: unknown) {
    super(detail);
    this.name = 'ApiRequestError';
    this.status = status;
    this.detail = detail;
    this.body = body;
  }
}

/**
 * Translate an HTTP status code into a user-friendly Spanish message.
 */
function statusMessage(status: number): string {
  switch (status) {
    case 400:
      return 'Solicitud inválida.';
    case 404:
      return 'El recurso solicitado no fue encontrado.';
    case 422:
      return 'Los datos enviados no son válidos.';
    case 500:
    case 502:
    case 503:
      return 'Ocurrió un error en el servidor. Intente nuevamente más tarde.';
    default:
      return `Error del servidor (${status}).`;
  }
}

/**
 * Flatten a FastAPI 422 validation error detail into a readable string.
 *
 * FastAPI 422 responses have `detail` as an array of objects like:
 *   [{"loc":["body","nombre"],"msg":"field required","type":"value_error.missing"}]
 *
 * This joins all `msg` fields and falls back to the general 422 message.
 */
function flatten422Detail(detail: unknown): string {
  if (Array.isArray(detail)) {
    const messages = detail
      .filter(
        (item): item is { msg: string } =>
          typeof item === 'object' && item !== null && typeof (item as { msg?: unknown }).msg === 'string',
      )
      .map((item) => item.msg);
    if (messages.length > 0) {
      return messages.join('. ');
    }
  }
  return statusMessage(422);
}

/**
 * Build a user-friendly error detail from the response status and body.
 */
function formatErrorDetail(status: number, body: unknown): string {
  if (body && typeof body === 'object' && body !== null && 'detail' in body) {
    const detail = (body as Record<string, unknown>).detail;

    // FastAPI 422: detail can be an array of validation errors or a string
    if (status === 422) {
      if (Array.isArray(detail)) {
        return flatten422Detail(detail);
      }
      if (typeof detail === 'string') {
        return detail;
      }
      return statusMessage(422);
    }

    // Any status with a string detail
    if (typeof detail === 'string') {
      return detail;
    }
  }

  // Last resort: generic status-based message (body is not JSON or has no detail)
  return statusMessage(status);
}

/**
 * Translate an {@link ApiRequestError} into a user-friendly Spanish message.
 *
 * Maps known HTTP status codes to short messages and flattens FastAPI 422
 * validation arrays into readable strings (field: message, joined by " / ").
 *
 * @param error — The error thrown by the API client
 * @returns A human-readable Spanish error message
 */
export function parseApiError(error: ApiRequestError): string {
  // 422: inspect body.detail for validation error arrays
  if (error.status === 422 && error.body) {
    const body = error.body as Record<string, unknown> | undefined;
    if (body && 'detail' in body) {
      const detail = body.detail;

      if (Array.isArray(detail)) {
        const messages = detail
          .filter(
            (item): item is { loc: unknown[]; msg: string } =>
              typeof item === 'object' &&
              item !== null &&
              Array.isArray((item as { loc?: unknown }).loc) &&
              typeof (item as { msg?: unknown }).msg === 'string',
          )
          .map((item) => {
            const field = item.loc.length > 0 ? String(item.loc[item.loc.length - 1]) : 'unknown';
            return `${field}: ${item.msg}`;
          });
        if (messages.length > 0) {
          return messages.join(' / ');
        }
      }

      if (typeof detail === 'string') {
        return detail;
      }
    }
  }

  // Status-based short messages
  switch (error.status) {
    case 400:
      return 'Solicitud inválida';
    case 404:
      return 'Recurso no encontrado';
    case 422:
    case 500:
    case 502:
    case 503:
      return 'Error del servidor';
    default:
      return 'Error inesperado';
  }
}

/**
 * Parse the response body and throw on non-ok status.
 *
 * 204 No Content returns `undefined` (void).
 * Non-2xx responses throw an {@link ApiRequestError} with a user-friendly detail.
 */
async function handleResponse(response: Response): Promise<unknown> {
  if (!response.ok) {
    let detail: string;
    let body: unknown;
    try {
      body = await response.json();
      detail = formatErrorDetail(response.status, body);
    } catch {
      detail = statusMessage(response.status);
    }
    throw new ApiRequestError(response.status, detail, body);
  }

  if (response.status === 204) {
    return undefined;
  }

  return response.json();
}

/**
 * Build a full URL from a path and optional query params.
 */
function buildUrl(
  path: string,
  params?: Record<string, string | number>,
): string {
  const url = new URL(`${API_BASE}${path}`, window.location.origin);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

/**
 * Perform a GET request and return the typed JSON body.
 *
 * @param path  — API path (e.g. `"/indicadores/"`)
 * @param params — Optional query parameters
 * @returns Parsed JSON response cast to `T`
 * @throws {ApiRequestError} on non-2xx responses
 */
export async function apiGet<T>(
  path: string,
  params?: Record<string, string | number>,
): Promise<T> {
  const url = buildUrl(path, params);
  const response = await fetch(url, { method: 'GET' });
  return handleResponse(response) as Promise<T>;
}

/**
 * Perform a POST request with a JSON body and return the typed JSON body.
 *
 * @param path — API path (e.g. `"/indicadores/a1b2c3d4/versiones"`)
 * @param body — JSON-serializable request body
 * @returns Parsed JSON response cast to `T`
 * @throws {ApiRequestError} on non-2xx responses
 */
export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const url = buildUrl(path);
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return handleResponse(response) as Promise<T>;
}

/**
 * Perform a PUT request with a JSON body and return the typed JSON body.
 *
 * @param path — API path (e.g. `"/indicadores/a1b2c3d4"`)
 * @param body — JSON-serializable request body
 * @returns Parsed JSON response cast to `T`
 * @throws {ApiRequestError} on non-2xx responses
 */
export async function apiPut<T>(path: string, body: unknown): Promise<T> {
  const url = buildUrl(path);
  const response = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return handleResponse(response) as Promise<T>;
}

/**
 * Perform a DELETE request.
 *
 * @param path — API path (e.g. `"/indicadores/bc58b115-fff9-4a51-8a9c-1b5a4cf6f8ca"`)
 * @throws {ApiRequestError} on non-2xx responses
 */
export async function apiDelete(path: string): Promise<void> {
  const url = buildUrl(path);
  const response = await fetch(url, { method: 'DELETE' });
  await handleResponse(response);
}
