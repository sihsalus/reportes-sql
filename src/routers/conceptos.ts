/**
 * Conceptos proxy router — forwards requests to the OpenMRS REST API.
 *
 * - GET /conceptos/encounter-types → proxy OpenMRS encountertype endpoint
 * - GET /conceptos/buscar?q=...&clase=... → proxy OpenMRS concept search
 * - GET /conceptos/diagnosticos/buscar?q= → proxy with CIE-10 extraction
 * - GET /conceptos/locations?q= → proxy OpenMRS location search
 * - GET /conceptos/locations/resolve?uuids=... → batch resolve location UUIDs
 * - GET /conceptos/diagnosticos/resolve?uuids=... → batch resolve diagnosis UUIDs
 * - GET /conceptos/buscar/resolve?uuids=... → batch resolve concept UUID → display label
 *
 * All communication uses fetch with Basic Auth. Connection errors
 * return 502 Bad Gateway with a descriptive message.
 */

import { Router, type Request, type Response } from "express";
import {
  authHeader,
  openmrsUrl,
  DIAGNOSIS_CONCEPT_REPRESENTATION,
  extractCie10Code,
  extractNombre,
  type DiagnosisConcept,
  proxyWithErrorHandling,
} from "./conceptos/helpers.js";
import {
  handleBuscarResolve,
  handleLocationsResolve,
  handleDiagnosticosResolve,
} from "./conceptos/resolve.js";

export const conceptosRouter: Router = Router();

// ── GET /conceptos/encounter-types ─────────────────────────────────────────

conceptosRouter.get(
  "/encounter-types",
  async (_req: Request, res: Response) => {
    await proxyWithErrorHandling(res, async () => {
      const url = openmrsUrl("encountertype");
      const response = await fetch(
        `${url}?v=custom:(uuid,display)`,
        {
          headers: { Authorization: authHeader() },
          signal: AbortSignal.timeout(10_000),
        },
      );
      if (!response.ok) {
        res
          .status(502)
          .json({
            detail: `OpenMRS respondió con error: ${response.status}`,
          });
        return;
      }
      const data = (await response.json()) as {
        results: Array<{ uuid: string; display: string }>;
      };
      res.json(
        (data.results ?? []).map((item) => ({
          uuid: item.uuid,
          display: item.display,
        })),
      );
    });
  },
);

// ── GET /conceptos/buscar/resolve?uuids=... ────────────────────────────────
// Must be registered before /buscar to avoid route ambiguity.

conceptosRouter.get(
  "/buscar/resolve",
  async (req: Request, res: Response) => {
    await handleBuscarResolve(req, res);
  },
);

// ── GET /conceptos/buscar?q=...&clase=... ──────────────────────────────────

conceptosRouter.get("/buscar", async (req: Request, res: Response) => {
  await proxyWithErrorHandling(res, async () => {
    const q = (req.query["q"] as string) ?? "";
    const clase = (req.query["clase"] as string) ?? "Diagnosis";

    if (!q.trim()) {
      res.status(400).json({
        detail: "El parámetro 'q' es obligatorio",
      });
      return;
    }

    const url = openmrsUrl("concept");
    const params = new URLSearchParams({
      q,
      class: clase,
      v: "custom:(uuid,display)",
      limit: "50",
    });

    const response = await fetch(`${url}?${params}`, {
      headers: { Authorization: authHeader() },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      res
        .status(502)
        .json({
          detail: `OpenMRS respondió con error: ${response.status}`,
        });
      return;
    }
    const data = (await response.json()) as {
      results: Array<{ uuid: string; display: string }>;
    };
    res.json(
      (data.results ?? []).map((item) => ({
        uuid: item.uuid,
        display: item.display,
      })),
    );
  });
});

// ── GET /conceptos/diagnosticos/buscar?q=... ───────────────────────────────

conceptosRouter.get(
  "/diagnosticos/buscar",
  async (req: Request, res: Response) => {
    await proxyWithErrorHandling(res, async () => {
      const q = ((req.query["q"] as string) ?? "").trim();

      if (!q) {
        res.status(400).json({
          detail:
            "El parámetro 'q' es obligatorio y no puede estar vacío",
        });
        return;
      }

      const url = openmrsUrl("concept");
      const params = new URLSearchParams({
        q,
        v: DIAGNOSIS_CONCEPT_REPRESENTATION,
        limit: "10",
        class: "Diagnosis",
      });

      const response = await fetch(`${url}?${params}`, {
        headers: { Authorization: authHeader() },
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        res
          .status(502)
          .json({
            detail: `OpenMRS respondió con error: ${response.status}`,
          });
        return;
      }
      const data = (await response.json()) as {
        results?: DiagnosisConcept[];
      };

      const results = (data.results ?? []).map((item) => {
        const codigo = extractCie10Code(item);
        const out: { uuid: string; codigo?: string; nombre: string } = {
          uuid: item.uuid,
          nombre: extractNombre(item),
        };
        if (codigo) out.codigo = codigo;
        return out;
      });

      res.json(results);
    });
  },
);

// ── GET /conceptos/locations?q=...&limit=...&offset=... ────────────────────
//
// Two modes, same response shape ([{uuid, display}] in stable display-ascending
// order; retired locations are excluded by OpenMRS's default):
// - with a term (q): seed search + services fallback, filtered locally;
// - without a term: the first page of services, so a selector can populate on
//   focus instead of requiring the user to type first.

const LOCATIONS_DEFAULT_LIMIT = 50;
const LOCATIONS_MAX_LIMIT = 50;
/** Bounded set fetched before sorting/slicing (OpenMRS location is unsorted). */
const LOCATIONS_FETCH_LIMIT = 200;
/**
 * Broad seed naming the service locations ("UPSS - …"). Used to list services
 * (no term) and as the search fallback.
 */
const LOCATIONS_SERVICES_SEED = "upss";

interface LocationItem {
  uuid: string;
  display: string;
}

function parseLocationsLimit(raw: unknown): number {
  if (typeof raw !== "string" || raw.trim() === "") {
    return LOCATIONS_DEFAULT_LIMIT;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) return LOCATIONS_DEFAULT_LIMIT;
  return Math.min(value, LOCATIONS_MAX_LIMIT);
}

function parseLocationsOffset(raw: unknown): number {
  if (typeof raw !== "string" || raw.trim() === "") return 0;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) return 0;
  return value;
}

conceptosRouter.get("/locations", async (req: Request, res: Response) => {
  await proxyWithErrorHandling(res, async () => {
    const q = ((req.query["q"] as string) ?? "").trim();
    const limit = parseLocationsLimit(req.query["limit"]);
    const offset = parseLocationsOffset(req.query["offset"]);

    const url = openmrsUrl("location");
    const baseParams = new URLSearchParams({
      v: "custom:(uuid,display)",
      limit: String(LOCATIONS_FETCH_LIMIT),
    });

    const fetchSeed = async (
      seed: string,
    ): Promise<{ status: number; items: LocationItem[] | null }> => {
      const response = await fetch(
        `${url}?${baseParams}&q=${encodeURIComponent(seed)}`,
        {
          headers: { Authorization: authHeader() },
          signal: AbortSignal.timeout(10_000),
        },
      );
      if (!response.ok) return { status: response.status, items: null };
      const data = (await response.json()) as {
        results?: Array<{ uuid: string; display: string }>;
      };
      return {
        status: response.status,
        items: (data.results ?? []).map((item) => ({
          uuid: item.uuid,
          display: item.display,
        })),
      };
    };

    const send = (items: LocationItem[]): void => {
      items.sort((a, b) => a.display.localeCompare(b.display, "es"));
      res.json(items.slice(offset, offset + limit));
    };

    // No term → list the services (the configured broad seed).
    if (!q) {
      const { status, items } = await fetchSeed(LOCATIONS_SERVICES_SEED);
      if (items === null) {
        res
          .status(502)
          .json({ detail: `OpenMRS respondió con error: ${status}` });
        return;
      }
      send(items);
      return;
    }

    const normalizedQuery = q.toLowerCase();
    const matches = (items: LocationItem[]): LocationItem[] =>
      items.filter((item) =>
        item.display.toLowerCase().includes(normalizedQuery),
      );

    // First pass: query-derived seed.
    const first = await fetchSeed(normalizedQuery.slice(0, 3));
    if (first.items === null) {
      res
        .status(502)
        .json({ detail: `OpenMRS respondió con error: ${first.status}` });
      return;
    }
    let results = matches(first.items);

    // Fallback pass: broad services seed.
    if (results.length === 0) {
      const fallback = await fetchSeed(LOCATIONS_SERVICES_SEED);
      if (fallback.items === null) {
        res
          .status(502)
          .json({ detail: `OpenMRS respondió con error: ${fallback.status}` });
        return;
      }
      results = matches(fallback.items);
    }

    send(results);
  });
});

// ── GET /conceptos/locations/resolve?uuids=... ─────────────────────────────

conceptosRouter.get(
  "/locations/resolve",
  async (req: Request, res: Response) => {
    await handleLocationsResolve(req, res);
  },
);

// ── GET /conceptos/diagnosticos/resolve?uuids=... ──────────────────────────

conceptosRouter.get(
  "/diagnosticos/resolve",
  async (req: Request, res: Response) => {
    await handleDiagnosticosResolve(req, res);
  },
);
