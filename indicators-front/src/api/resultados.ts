/**
 * Resultados API functions.
 *
 * Each function calls the typed client (`client.ts`) which handles
 * URL construction, response parsing, and error throwing.
 */

import { apiGet, apiPost } from './client';
import type {
  IndicadorResultado,
  BatchCalcularNowResponse,
  GetResultadosParams,
  PaginatedResponse,
} from './types';

/**
 * Fetch a paginated list of indicator results with optional filters.
 *
 * Backend: `GET /resultados?indicador_id={id}&periodo_inicio={date}&periodo_fin={date}&page={page}&size={size}`
 *
 * @param params — Query parameters including pagination and optional filters
 */
export function getResultados(
  params: GetResultadosParams,
): Promise<PaginatedResponse<IndicadorResultado>> {
  return apiGet<PaginatedResponse<IndicadorResultado>>('/resultados/', params);
}

/**
 * Trigger batch calculation for all active indicators.
 *
 * Backend: `POST /resultados/calcular-ahora`
 * Returns a summary of successful calculations and any errors.
 */
export function calcularAhora(): Promise<BatchCalcularNowResponse> {
  return apiPost<BatchCalcularNowResponse>('/resultados/calcular-ahora', {});
}
