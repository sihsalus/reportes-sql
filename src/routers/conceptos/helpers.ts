/**
 * Shared helpers for conceptos proxy routes.
 *
 * Extracted to avoid duplication across search and resolve endpoint modules.
 */
import type { Request, Response } from "express";
import { settings } from "../../config/index.js";
import { extractJSESSIONID } from "../../middleware/auth.js";

export const MAX_RESOLVE_UUIDS = 100;
export const MAX_OPENMRS_CONCURRENCY = 8;

// ── Auth & URL ─────────────────────────────────────────────────────────────

/**
 * Headers that forward the caller's OpenMRS session to upstream OpenMRS calls.
 * Only the session cookie travels — never service credentials. The session is
 * already validated by `requireSession` before this router runs.
 */
export function openmrsSessionHeaders(req: Request): { Cookie: string } {
  const jsessionid = extractJSESSIONID(req.headers["cookie"]);
  if (!jsessionid) {
    throw new Error("Sesión OpenMRS ausente");
  }
  return { Cookie: `JSESSIONID=${jsessionid}` };
}

export function openmrsUrl(path: string): string {
  const base = settings.openmrs_api_url.replace(/\/+$/, "");
  return `${base}/ws/rest/v1/${path.replace(/^\/+/, "")}`;
}

// ── Diagnosis concepts: representation + CIE-10 extraction ──────────────────
//
// Mirrors the CIE-10 convention already implemented on the front
// (esm-patient-notes-app/src/notes/catalog-concept.utils.ts): the code comes
// from the concept's explicit ICD-10/CIE-10 reference-term mapping, or — in
// the MINSA catalog — from its SHORT name. Free display text is never treated
// as authority (a legacy display can merely look like a code).

/**
 * OpenMRS custom representation for diagnosis concepts. `conceptMappings`
 * carries the reference terms (code + source) and `names` carries the
 * `conceptNameType` needed to spot the catalog SHORT name.
 */
export const DIAGNOSIS_CONCEPT_REPRESENTATION =
  "custom:(uuid,display,names:(display,conceptNameType,locale),conceptMappings:(conceptReferenceTerm:(conceptSource:(name,display),code)))";

export interface ConceptName {
  display?: string;
  name?: string;
  conceptNameType?: string | null;
  locale?: string;
}

export interface ConceptReferenceMapping {
  display?: string;
  conceptReferenceTerm?: {
    code?: string;
    display?: string;
    conceptSource?: { name?: string; display?: string };
  };
}

export interface DiagnosisConcept {
  uuid: string;
  display?: string;
  names?: ConceptName[];
  conceptMappings?: ConceptReferenceMapping[];
  mappings?: ConceptReferenceMapping[];
}

const CIE10_CODE_RE = /^[A-Z][0-9][A-Z0-9.]{1,5}$/i;
const CIE10_SOURCE_RE = /icd[-\s]?10|cie[-\s]?10/i;
const CIE10_PREFIX_RE =
  /^\s*(?<code>[A-Z][0-9][A-Z0-9.]{1,5})\s*(?:[-–—:]\s*|\s+)(?<name>.+?)\s*$/i;
const CIE10_SUFFIX_RE =
  /^\s*(?<name>.+?)\s*\((?<code>[A-Z][0-9][A-Z0-9.]{1,5})\)\s*$/i;

/** Code from an explicit ICD-10/CIE-10 concept mapping, if any. */
function mappedCie10Code(
  mappings: ConceptReferenceMapping[],
): string | undefined {
  const hit = mappings.find((mapping) => {
    const source =
      mapping.conceptReferenceTerm?.conceptSource?.name?.trim() ||
      mapping.conceptReferenceTerm?.conceptSource?.display?.trim() ||
      "";
    const code = mapping.conceptReferenceTerm?.code?.trim();
    return CIE10_SOURCE_RE.test(source) && Boolean(code);
  });
  return hit?.conceptReferenceTerm?.code?.trim() || undefined;
}

/** Code carried by the catalog's SHORT name, when it is shaped like one. */
function shortNameCie10Code(names: ConceptName[]): string | undefined {
  const hit = names.find((name) => {
    if (name.conceptNameType !== "SHORT") return false;
    const text = (name.display ?? name.name ?? "").trim();
    return text.length > 0 && CIE10_CODE_RE.test(text);
  });
  return (hit?.display ?? hit?.name ?? "").trim() || undefined;
}

/**
 * Authoritative CIE-10 code: an explicit ICD-10/CIE-10 mapping, else the
 * catalog SHORT name when it matches the code pattern. Display text is
 * intentionally not a fallback.
 */
export function extractCie10Code(
  concept: DiagnosisConcept,
): string | undefined {
  const mappings = concept.conceptMappings ?? concept.mappings ?? [];
  const code =
    mappedCie10Code(mappings) ?? shortNameCie10Code(concept.names ?? []);
  return code ? code.toLocaleUpperCase("es-PE") : undefined;
}

/** Human-readable name: the display with any leading/trailing code stripped. */
export function extractNombre(concept: DiagnosisConcept): string {
  const display = (concept.display ?? "").trim();
  if (!display) return "Sin nombre";
  const match =
    display.match(CIE10_PREFIX_RE) ?? display.match(CIE10_SUFFIX_RE);
  const name = (match?.groups?.["name"] ?? display).trim();
  return name || display;
}

// ── Error handling ─────────────────────────────────────────────────────────

export async function proxyWithErrorHandling(
  res: Response,
  fn: () => Promise<void>,
): Promise<void> {
  try {
    await fn();
  } catch (err: unknown) {
    if (err instanceof Error) {
      res.status(502).json({
        detail: `Error conectando a OpenMRS: ${err.message}`,
      });
    } else {
      res.status(502).json({
        detail: "Error conectando a OpenMRS",
      });
    }
  }
}

// ── UUID parsing & validation ──────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseUuidList(raw: string): string[] {
  return [
    ...new Set(
      raw
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
    ),
  ];
}

export function validateUuids(
  uuids: string[],
): { valid: string[]; invalid: string[] } {
  const valid: string[] = [];
  const invalid: string[] = [];
  for (const uuid of uuids) {
    if (UUID_RE.test(uuid)) {
      valid.push(uuid);
    } else {
      invalid.push(uuid);
    }
  }
  return { valid, invalid };
}

export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) return;
      results[index] = await mapper(items[index], index);
    }
  }

  const workerCount = Math.min(MAX_OPENMRS_CONCURRENCY, items.length);
  await Promise.all(
    Array.from({ length: workerCount }, () => worker()),
  );
  return results;
}
