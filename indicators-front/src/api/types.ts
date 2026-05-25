/**
 * Shared TypeScript types for the API layer.
 *
 * These types match the backend Pydantic schemas defined in
 * app/schemas/indicador.py. UUIDs are serialized as strings in JSON.
 */

export interface Indicador {
  /** UUID — serialized as string in JSON */
  id: string;
  /** Human-readable indicator name */
  nombre: string;
  /** Optional free-text description */
  descripcion: string | null;
  /** Soft-delete flag */
  activo: boolean;
  /** ISO 8601 datetime string */
  creado_en: string;
}

/** Single version of an indicator — matches backend VersionOut schema. */
export interface IndicadorVersion {
  /** UUID of the version record */
  id: string;
  /** UUID of the parent indicator */
  indicador_id: string;
  /** Sequential version number (auto-incremented) */
  version: number;
  /** Arbitrary JSON definition object */
  definicion: Record<string, unknown>;
  /** ISO 8601 datetime string */
  creado_en: string;
}

/** Full indicator with its version history. */
export interface IndicadorDetail extends Indicador {
  versiones: IndicadorVersion[];
}

/** Generic paginated response envelope — matches IndicadorListResponse */
export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  size: number;
  pages: number;
}

/** FastAPI error body shape: { "detail": "..." } or { "detail": [...] } for 422 */
export interface ApiError {
  detail: string | unknown[];
}

// ── Form / Request Types ────────────────────────────────────────────────

/** Payload for POST /indicadores/ */
export interface IndicadorCreatePayload {
  nombre: string;
  descripcion: string | null;
  definicion: DefinicionIndicadorForm;
}

/** Payload for PUT /indicadores/{id} */
export interface IndicadorUpdatePayload {
  nombre: string;
  descripcion: string | null;
  definicion?: DefinicionIndicadorForm;
}

/** Encounter type option returned by GET /conceptos/encounter-types */
export interface EncounterTypeOption {
  uuid: string;
  display: string;
}

/** Location option returned by GET /conceptos/locations */
export interface LocationOption {
  uuid: string;
  display: string;
}

/** Diagnosis concept option returned by GET /conceptos/diagnosticos/buscar */
export interface DiagnosticoOption {
  uuid: string;
  codigo?: string;
  nombre: string;
}

/** Frontend representation of DefinicionIndicador for forms */
export interface DefinicionIndicadorForm {
  tipo: 'conteo_atenciones' | 'conteo_pacientes';
  periodo: 'mes_actual' | 'trimestre_actual' | 'semestre_actual' | 'anual_actual';
  evento: FiltrosEventoForm | null;
  poblacion?: PoblacionForm;
}

/** Single event definition for forms — diagnosticos/ordenes nested inside. */
export interface FiltrosEventoForm {
  location_uuids: string[];
  minimo_ocurrencias?: number;
  diagnosticos?: FiltroDiagnosticoForm[];
  ordenes?: FiltroOrdenForm[];
}

/** Single diagnosis filter for forms — nested inside evento. */
export interface FiltroDiagnosticoForm {
  concepto_uuids: string[];
  tipo_diagnostico?: 'definitivo' | 'presuntivo';
}

/** Single order filter for forms — nested inside evento. */
export interface FiltroOrdenForm {
  concepto_uuids: string[];
}

/** Concept option returned by GET /conceptos/buscar */
export interface OrdenOption {
  uuid: string;
  display: string;
}

/** Optional population filter for forms */
export interface PoblacionForm {
  min_anios?: number;
  max_anios_excl?: number;
  min_meses?: number;
  max_meses_excl?: number;
  min_dias?: number;
  max_dias?: number;
  sexo?: 'M' | 'F';
}

// ── Resultados Types ────────────────────────────────────────────────────

/** Single enriched indicator result — matches backend IndicadorResultadoEnrichedResponse */
export interface IndicadorResultado {
  id: string;
  indicador_version_id: string;
  indicador_nombre: string | null;
  indicador_version_num: number | null;
  periodo_inicio: string;
  periodo_fin: string;
  valor: number;
  calculado_en: string;
}

/** Error entry for a single indicator during batch calculation */
export interface ErrorCalculo {
  indicador_id: string;
  indicador_nombre: string;
  error: string;
}

/** Response from POST /resultados/calcular-ahora */
export interface BatchCalcularNowResponse {
  calculados: number;
  errores: ErrorCalculo[];
  total: number;
}

/** Filter values for the resultados list */
export interface ResultadosFilters {
  indicador_id?: string;
  periodo_inicio?: string;
  periodo_fin?: string;
}

/** Query parameters for GET /resultados */
export interface GetResultadosParams extends ResultadosFilters {
  page: number;
  size: number;
}
