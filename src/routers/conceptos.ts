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
  extractCie10FromNames,
  extractNombreFromNames,
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
        v: "full",
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
        results: Array<{
          uuid: string;
          display: string;
          names?: Array<{ display: string }>;
        }>;
      };

      const results = (data.results ?? []).map((item) => {
        const names = item.names ?? [];
        const codigo = extractCie10FromNames(names);
        const nombre =
          extractNombreFromNames(names) ?? item.display ?? "Sin nombre";
        const out: { uuid: string; codigo?: string; nombre: string } = {
          uuid: item.uuid,
          nombre,
        };
        if (codigo) out.codigo = codigo;
        return out;
      });

      res.json(results);
    });
  },
);

// ── GET /conceptos/locations?q=... ─────────────────────────────────────────

conceptosRouter.get("/locations", async (req: Request, res: Response) => {
  await proxyWithErrorHandling(res, async () => {
    const q = ((req.query["q"] as string) ?? "").trim();

    if (!q) {
      res.status(400).json({
        detail:
          "El parámetro 'q' es obligatorio y no puede estar vacío",
      });
      return;
    }

    const normalizedQuery = q.toLowerCase();
    const querySeed = normalizedQuery.slice(0, 3);

    const url = openmrsUrl("location");
    const baseParams = new URLSearchParams({
      v: "custom:(uuid,display)",
      limit: "200",
    });

    const filterLocations = (
      raw: { results?: Array<{ uuid: string; display: string }> },
    ) => {
      return (raw.results ?? [])
        .filter((item) =>
          (item.display ?? "").toLowerCase().includes(normalizedQuery),
        )
        .map((item) => ({ uuid: item.uuid, display: item.display }));
    };

    // First pass: query-derived seed
    let response = await fetch(
      `${url}?${baseParams}&q=${encodeURIComponent(querySeed)}`,
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
    let data = (await response.json()) as {
      results?: Array<{ uuid: string; display: string }>;
    };
    let results = filterLocations(data);
    if (results.length > 0) {
      res.json(results);
      return;
    }

    // Fallback pass: broad seed ("upss")
    response = await fetch(
      `${url}?${baseParams}&q=upss`,
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
    data = (await response.json()) as {
      results?: Array<{ uuid: string; display: string }>;
    };
    results = filterLocations(data);
    res.json(results);
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
