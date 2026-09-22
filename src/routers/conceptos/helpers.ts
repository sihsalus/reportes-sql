/**
 * Shared helpers for conceptos proxy routes.
 *
 * Extracted to avoid duplication across search and resolve endpoint modules.
 */
import type { Response } from "express";
import { settings } from "../../config/index.js";

export const MAX_RESOLVE_UUIDS = 100;
export const MAX_OPENMRS_CONCURRENCY = 8;

// ── Auth & URL ─────────────────────────────────────────────────────────────

export function authHeader(): string {
  const creds = Buffer.from(
    `${settings.openmrs_api_user}:${settings.openmrs_api_password}`,
  ).toString("base64");
  return `Basic ${creds}`;
}

export function openmrsUrl(path: string): string {
  const base = settings.openmrs_api_url.replace(/\/+$/, "");
  return `${base}/ws/rest/v1/${path.replace(/^\/+/, "")}`;
}

// ── CIE-10 extraction ──────────────────────────────────────────────────────

// CIE-10 categories always start with a letter + two digits (E11, I10, J06),
// optionally followed by a dot + 1-2 digit subcategory (E11.9, J00.0), and a
// word boundary (space or end of string).
// Known limitation: without a CIE-10 catalog, displays like "B12 deficiency"
// can still match (B + 12); a regex cannot distinguish them from real codes.
const CIE10_RE = /^[A-Z]\d{2}(\.\d{1,2})?(\s|$)/i;

export function extractCie10FromNames(
  names: Array<{ display: string }>,
): string | null {
  for (const entry of names) {
    if (CIE10_RE.test(entry.display ?? "")) {
      return entry.display;
    }
  }
  return null;
}

export function extractNombreFromNames(
  names: Array<{ display: string }>,
): string | null {
  for (const entry of names) {
    if (!CIE10_RE.test(entry.display ?? "")) {
      return entry.display;
    }
  }
  return null;
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
