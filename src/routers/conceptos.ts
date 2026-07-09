/**
 * Conceptos proxy router — forwards requests to the OpenMRS REST API.
 *
 * - GET /conceptos/encounter-types → proxy OpenMRS encountertype endpoint
 * - GET /conceptos/buscar?q=...&clase=... → proxy OpenMRS concept search
 * - GET /conceptos/diagnosticos/buscar?q= → proxy with CIE-10 extraction
 * - GET /conceptos/locations?q= → proxy OpenMRS location search
 * - GET /conceptos/locations/resolve?uuids=... → batch resolve location UUIDs
 * - GET /conceptos/diagnosticos/resolve?uuids=... → batch resolve diagnosis UUIDs
 * - GET /conceptos/buscar/resolve?uuids=... → batch resolve concept UUID -> display label
 *
 * All communication uses fetch with Basic Auth. Connection errors
 * return 502 Bad Gateway with a descriptive message.
 */

import { Router, type Request, type Response } from "express";
import { settings } from "../config/index.js";

export const conceptosRouter: Router = Router();

// ── Auth helpers ───────────────────────────────────────────────────────

function authHeader(): string {
  const creds = Buffer.from(
    `${settings.openmrs_api_user}:${settings.openmrs_api_password}`,
  ).toString("base64");
  return `Basic ${creds}`;
}

function openmrsUrl(path: string): string {
  const base = settings.openmrs_api_url.replace(/\/+$/, "");
  return `${base}/ws/rest/v1/${path.replace(/^\/+/, "")}`;
}

// ── CIE-10 extraction helpers ───────────────────────────────────────────

const CIE10_RE = /^[A-Z]\d/i;

function extractCie10FromNames(
  names: Array<{ display: string }>,
): string | null {
  for (const entry of names) {
    if (CIE10_RE.test(entry.display ?? "")) {
      return entry.display;
    }
  }
  return null;
}

function extractNombreFromNames(
  names: Array<{ display: string }>,
): string | null {
  for (const entry of names) {
    if (!CIE10_RE.test(entry.display ?? "")) {
      return entry.display;
    }
  }
  return null;
}

// ── Error handler helper ────────────────────────────────────────────────

async function proxyWithErrorHandling(
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

// ── Endpoints ──────────────────────────────────────────────────────────

// GET /conceptos/encounter-types
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

// GET /conceptos/buscar/resolve?uuids=...
// Must be registered before /buscar to avoid route ambiguity.
conceptosRouter.get(
  "/buscar/resolve",
  async (req: Request, res: Response) => {
    await proxyWithErrorHandling(res, async () => {
      const uuidParam = (req.query["uuids"] as string) ?? "";
      const uuidList = parseUuidList(uuidParam);
      const { valid, invalid } = validateUuids(uuidList);

      if (invalid.length > 0) {
        res.status(400).json({
          detail: `UUIDs con formato inválido: ${invalid.join(", ")}`,
        });
        return;
      }

      if (valid.length === 0) {
        res.status(400).json({
          detail:
            "El parámetro 'uuids' debe contener al menos un UUID válido",
        });
        return;
      }

      const result: Record<string, string> = {};

      const fetches = valid.map(async (uid) => {
        const url = openmrsUrl(`concept/${uid}`);
        try {
          const resp = await fetch(
            `${url}?v=custom:(uuid,display)`,
            {
              headers: { Authorization: authHeader() },
              signal: AbortSignal.timeout(10_000),
            },
          );
          if (resp.status === 404) return null;
          if (!resp.ok) {
            throw new Error(`OpenMRS respondió con error: ${resp.status}`);
          }
          const data = (await resp.json()) as {
            uuid: string;
            display: string;
          };
          return { uuid: data.uuid, display: data.display };
        } catch {
          throw new Error("Error conectando a OpenMRS");
        }
      });

      const fetched = await Promise.all(fetches);
      for (const item of fetched) {
        if (item !== null) {
          result[item.uuid] = item.display;
        }
      }

      res.json(result);
    });
  },
);

// GET /conceptos/buscar?q=...&clase=...
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

// GET /conceptos/diagnosticos/buscar?q=...
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

// GET /conceptos/locations?q=...
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

// ── Batch Resolve Endpoints ────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseUuidList(raw: string): string[] {
  return [
    ...new Set(
      raw
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
    ),
  ];
}

function validateUuids(uuids: string[]): { valid: string[]; invalid: string[] } {
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

// GET /conceptos/locations/resolve?uuids=...
conceptosRouter.get(
  "/locations/resolve",
  async (req: Request, res: Response) => {
    await proxyWithErrorHandling(res, async () => {
      const uuidParam = (req.query["uuids"] as string) ?? "";
      const uuidList = parseUuidList(uuidParam);
      const { valid, invalid } = validateUuids(uuidList);

      if (invalid.length > 0) {
        res.status(400).json({
          detail: `UUIDs con formato inválido: ${invalid.join(", ")}`,
        });
        return;
      }

      if (valid.length === 0) {
        res.status(400).json({
          detail:
            "El parámetro 'uuids' debe contener al menos un UUID válido",
        });
        return;
      }

      const results: Array<{ uuid: string; display: string }> = [];

      const fetches = valid.map(async (uid) => {
        const url = openmrsUrl(`location/${uid}`);
        try {
          const resp = await fetch(
            `${url}?v=custom:(uuid,display)`,
            {
              headers: { Authorization: authHeader() },
              signal: AbortSignal.timeout(10_000),
            },
          );
          if (resp.status === 404) return null;
          if (!resp.ok) {
            throw new Error(`OpenMRS respondió con error: ${resp.status}`);
          }
          const data = (await resp.json()) as {
            uuid: string;
            display: string;
          };
          return { uuid: data.uuid, display: data.display };
        } catch {
          throw new Error("Error conectando a OpenMRS");
        }
      });

      const fetched = await Promise.all(fetches);
      for (const item of fetched) {
        if (item !== null) {
          results.push(item);
        }
      }

      res.json(results);
    });
  },
);

// GET /conceptos/diagnosticos/resolve?uuids=...
conceptosRouter.get(
  "/diagnosticos/resolve",
  async (req: Request, res: Response) => {
    await proxyWithErrorHandling(res, async () => {
      const uuidParam = (req.query["uuids"] as string) ?? "";
      const uuidList = parseUuidList(uuidParam);
      const { valid, invalid } = validateUuids(uuidList);

      if (invalid.length > 0) {
        res.status(400).json({
          detail: `UUIDs con formato inválido: ${invalid.join(", ")}`,
        });
        return;
      }

      if (valid.length === 0) {
        res.status(400).json({
          detail:
            "El parámetro 'uuids' debe contener al menos un UUID válido",
        });
        return;
      }

      const results: Array<{
        uuid: string;
        codigo?: string;
        nombre: string;
      }> = [];

      const fetches = valid.map(async (uid) => {
        const url = openmrsUrl(`concept/${uid}`);
        try {
          const resp = await fetch(
            `${url}?v=full`,
            {
              headers: { Authorization: authHeader() },
              signal: AbortSignal.timeout(10_000),
            },
          );
          if (resp.status === 404) return null;
          if (!resp.ok) {
            throw new Error(`OpenMRS respondió con error: ${resp.status}`);
          }
          const item = (await resp.json()) as {
            uuid: string;
            display: string;
            names?: Array<{ display: string }>;
          };
          const names = item.names ?? [];
          const codigo = extractCie10FromNames(names);
          const nombre =
            extractNombreFromNames(names) ??
            item.display ??
            "Sin nombre";
          const out: { uuid: string; codigo?: string; nombre: string } = {
            uuid: item.uuid,
            nombre,
          };
          if (codigo) out.codigo = codigo;
          return out;
        } catch {
          throw new Error("Error conectando a OpenMRS");
        }
      });

      const fetched = await Promise.all(fetches);
      for (const item of fetched) {
        if (item !== null) {
          results.push(item);
        }
      }

      res.json(results);
    });
  },
);
