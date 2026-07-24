/**
 * Shared helpers for conceptos proxy routes.
 *
 * Extracted to avoid duplication across search and resolve endpoint modules.
 */
import type { Response } from "express";
import { settings } from "../../config/index.js";

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

const CIE10_RE = /^[A-Z]\d/i;

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
