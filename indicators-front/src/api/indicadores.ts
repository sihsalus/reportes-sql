/**
 * Indicadores API functions.
 *
 * Each function calls the typed client (`client.ts`) which handles
 * URL construction, response parsing, and error throwing.
 */

import { apiDelete, apiGet, apiPost, apiPut } from './client';
import type {
  Indicador,
  IndicadorCreatePayload,
  IndicadorDetail,
  IndicadorUpdatePayload,
  IndicadorVersion,
  EncounterTypeOption,
  DiagnosticoOption,
  LocationOption,
  OrdenOption,
  PaginatedResponse,
} from './types';

/**
 * Fetch a paginated list of active indicators.
 *
 * Backend: `GET /indicadores?page={page}&size={size}`
 * Returns only indicators where `activo === true`, ordered by
 * `creado_en` descending (newest first).
 *
 * @param page — 1-indexed page number
 * @param size — Items per page (1–100)
 */
export function getIndicadores(
  page: number,
  size: number,
): Promise<PaginatedResponse<Indicador>> {
  return apiGet<PaginatedResponse<Indicador>>('/indicadores/', { page, size });
}

/**
 * Fetch a single indicator with its full version history.
 *
 * Backend: `GET /indicadores/{id}`
 * Returns 404 if the indicator is not found.
 *
 * @param id — Indicator UUID (string)
 */
export function getIndicador(id: string): Promise<IndicadorDetail> {
  return apiGet<IndicadorDetail>(`/indicadores/${id}`);
}

/**
 * Create a new version for an existing indicator.
 *
 * Backend: `POST /indicadores/{id}/versiones`
 * Returns 201 with the new version, 409 on conflict, 422 on validation error.
 *
 * @param id — Indicator UUID (string)
 * @param definicion — JSON definition object
 */
export function createVersion(
  id: string,
  definicion: Record<string, unknown>,
): Promise<IndicadorVersion> {
  return apiPost<IndicadorVersion>(`/indicadores/${id}/versiones`, { definicion });
}

/**
 * Create a new indicator with its first version.
 *
 * Backend: `POST /indicadores/`
 * Returns 201 with the created indicator, 422 on validation error.
 *
 * @param data — Full create payload including definicion
 */
export function createIndicador(data: IndicadorCreatePayload): Promise<Indicador> {
  return apiPost<Indicador>('/indicadores/', data);
}

/**
 * Update an indicator's metadata (nombre and descripcion).
 *
 * Backend: `PUT /indicadores/{id}`
 * Returns 200 with the updated indicator, 404 if not found, 422 on validation error.
 *
 * @param id — Indicator UUID (string)
 * @param data — Update payload
 */
export function updateIndicador(id: string, data: IndicadorUpdatePayload): Promise<Indicador> {
  return apiPut<Indicador>(`/indicadores/${id}`, data);
}

/**
 * Fetch all encounter types from OpenMRS.
 *
 * Backend: `GET /conceptos/encounter-types`
 * Returns a list of [{uuid, display}].
 */
export function getEncounterTypes(): Promise<EncounterTypeOption[]> {
  return apiGet<EncounterTypeOption[]>('/conceptos/encounter-types');
}

/**
 * Search diagnosis concepts with CIE-10 code extraction.
 *
 * Backend: `GET /conceptos/diagnosticos/buscar?q={q}`
 * Returns a list of [{uuid, codigo?, nombre}].
 */
export function searchDiagnosticos(q: string): Promise<DiagnosticoOption[]> {
  return apiGet<DiagnosticoOption[]>('/conceptos/diagnosticos/buscar', { q });
}

/**
 * Soft-delete an indicator by setting `activo = false`.
 *
 * Backend: `DELETE /indicadores/{id}`
 * Returns 204 No Content on success, 404 if the indicator is not found.
 *
 * @param id — Indicator UUID (string)
 */
export function deleteIndicador(id: string): Promise<void> {
  return apiDelete(`/indicadores/${id}`);
}

/**
 * Search locations via OpenMRS proxy.
 *
 * Backend: `GET /conceptos/locations?q={q}`
 * Returns a list of [{uuid, display}].
 */
export function searchLocations(q: string): Promise<LocationOption[]> {
  return apiGet<LocationOption[]>('/conceptos/locations', { q });
}

/**
 * Search concepts by query and class.
 *
 * Backend: `GET /conceptos/buscar?q={q}&clase={clase}`
 * Returns a list of [{uuid, display}].
 */
export function searchConceptos(q: string, clase: string): Promise<OrdenOption[]> {
  return apiGet<OrdenOption[]>('/conceptos/buscar', { q, clase });
}
