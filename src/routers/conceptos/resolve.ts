/**
 * Batch-resolve endpoints for conceptos proxy.
 *
 * - GET /buscar/resolve       → resolve concept UUIDs to display labels
 * - GET /locations/resolve    → resolve location UUIDs
 * - GET /diagnosticos/resolve → resolve diagnosis UUIDs with CIE-10 codes
 */
import type { Request, Response } from "express";
import {
  authHeader,
  openmrsUrl,
  extractCie10FromNames,
  extractNombreFromNames,
  proxyWithErrorHandling,
  parseUuidList,
  validateUuids,
} from "./helpers.js";

// ── GET /buscar/resolve ────────────────────────────────────────────────────

export async function handleBuscarResolve(
  req: Request,
  res: Response,
): Promise<void> {
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
        const resp = await fetch(`${url}?v=custom:(uuid,display)`, {
          headers: { Authorization: authHeader() },
          signal: AbortSignal.timeout(10_000),
        });
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
}

// ── GET /locations/resolve ─────────────────────────────────────────────────

export async function handleLocationsResolve(
  req: Request,
  res: Response,
): Promise<void> {
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
        const resp = await fetch(`${url}?v=custom:(uuid,display)`, {
          headers: { Authorization: authHeader() },
          signal: AbortSignal.timeout(10_000),
        });
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
}

// ── GET /diagnosticos/resolve ──────────────────────────────────────────────

export async function handleDiagnosticosResolve(
  req: Request,
  res: Response,
): Promise<void> {
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
        const resp = await fetch(`${url}?v=full`, {
          headers: { Authorization: authHeader() },
          signal: AbortSignal.timeout(10_000),
        });
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
          extractNombreFromNames(names) ?? item.display ?? "Sin nombre";
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
}
