/**
 * Indicador CRUD router — Express endpoints for indicator lifecycle.
 *
 * - POST   /indicadores                   → create Indicador + version 1
 * - GET    /indicadores                   → list active indicators (paginated)
 * - GET    /indicadores/:id               → detail with all versions
 * - PUT    /indicadores/:id               → update metadata (auto-versioning)
 * - DELETE /indicadores/:id               → soft-delete (activo=false)
 * - POST   /indicadores/:id/versiones     → create new immutable version
 * - GET    /indicadores/:id/preview-sql   → SQL preview (accepts version_id or versionId)
 */

import { Router, type Request, type Response } from "express";
import { v4 as uuidv4 } from "uuid";
import {
  Indicador,
  IndicadorVersion,
  IndicadorResultado,
} from "../models/indicador.js";
import {
  parseDefinicionIndicador,
  rejectPeriodoInPayload,
  type DefinicionIndicador,
} from "../types/definicion.js";
import {
  validarDefinicionLocationUuids,
} from "../validators/openmrs.js";
import { asyncHandler } from "../middleware/async-handler.js";
import { handleCreateVersion } from "./indicadores/versiones.js";
import { handlePreviewSql } from "./indicadores/preview-sql.js";

export const indicadoresRouter: Router = Router();

// ── POST /indicadores ──────────────────────────────────────────────────────

indicadoresRouter.post(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    const body = req.body as {
      nombre?: string;
      descripcion?: string | null;
      definicion?: unknown;
    };

    if (!body.nombre || typeof body.nombre !== "string" || body.nombre.trim().length === 0) {
      res.status(422).json({
        detail: {
          field: "nombre",
          message: "nombre es obligatorio y no puede estar vacío",
        },
      });
      return;
    }
    if (!body.definicion) {
      res.status(422).json({
        detail: {
          field: "definicion",
          message: "definicion es obligatorio",
        },
      });
      return;
    }

    // Reject inbound periodo (breaking contract change)
    if (body.definicion) {
      try {
        rejectPeriodoInPayload(body.definicion);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Validation error";
        res.status(422).json({
          detail: { field: "definicion.periodo", message },
        });
        return;
      }
    }

    // Parse and validate definicion
    let definicion: DefinicionIndicador;
    try {
      definicion = parseDefinicionIndicador(body.definicion);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Validation error";
      res.status(422).json({
        detail: { field: "definicion", message },
      });
      return;
    }

    // Validate location_uuids exist in OpenMRS before DB write.
    try {
      const unknownUuids = await validarDefinicionLocationUuids(definicion);
      if (unknownUuids.length > 0) {
        res.status(422).json({
          detail: {
            field: "location_uuids",
            unknown_uuids: unknownUuids,
          },
        });
        return;
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "OpenMRS no disponible";
      res.status(502).json({ detail: message });
      return;
    }

    const indicadorId = uuidv4();
    const now = new Date();

    await Indicador.create({
      id: indicadorId,
      nombre: body.nombre.trim(),
      descripcion: body.descripcion ?? null,
      activo: true,
      creado_en: now,
    });

    await IndicadorVersion.create({
      id: uuidv4(),
      indicador_id: indicadorId,
      version: 1,
      definicion: definicion as unknown as Record<string, unknown>,
      creado_en: now,
    });

    const created = await Indicador.findByPk(indicadorId);
    res.status(201).json(created?.toJSON());
  }),
);

// ── GET /indicadores ───────────────────────────────────────────────────────

indicadoresRouter.get(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    const page = Math.max(1, parseInt((req.query["page"] as string) ?? "1", 10) || 1);
    const size = Math.min(100, Math.max(1, parseInt((req.query["size"] as string) ?? "20", 10) || 20));

    const { count, rows } = await Indicador.findAndCountAll({
      where: { activo: true },
      order: [["creado_en", "DESC"]],
      offset: (page - 1) * size,
      limit: size,
    });

    const pages = Math.max(1, Math.ceil(count / size));

    res.json({
      items: rows,
      total: count,
      page,
      size,
      pages,
    });
  }),
);

// ── GET /indicadores/:id ───────────────────────────────────────────────────

indicadoresRouter.get(
  "/:id",
  asyncHandler(async (req: Request, res: Response) => {
    const id = req.params["id"] as string;
    const indicador = await Indicador.findByPk(id);
    if (!indicador) {
      res.status(404).json({ detail: "Indicador no encontrado" });
      return;
    }

    const versiones = await IndicadorVersion.findAll({
      where: { indicador_id: indicador.id },
      order: [["version", "DESC"]],
    });

    res.json({
      ...indicador.toJSON(),
      versiones: versiones.map((v) => v.toJSON()),
    });
  }),
);

// ── PUT /indicadores/:id ───────────────────────────────────────────────────

indicadoresRouter.put(
  "/:id",
  asyncHandler(async (req: Request, res: Response) => {
    const id = req.params["id"] as string;
    const indicador = await Indicador.findByPk(id);
    if (!indicador) {
      res.status(404).json({ detail: "Indicador no encontrado" });
      return;
    }

    const body = req.body as {
      nombre?: string;
      descripcion?: string | null;
      definicion?: unknown;
    };

    if (!body.nombre || typeof body.nombre !== "string" || body.nombre.trim().length === 0) {
      res.status(422).json({
        detail: {
          field: "nombre",
          message: "nombre es obligatorio",
        },
      });
      return;
    }

    // ── Auto-versioning when definicion is present ──
    if (body.definicion != null) {
      // Reject inbound periodo
      try {
        rejectPeriodoInPayload(body.definicion);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Validation error";
        res.status(422).json({
          detail: { field: "definicion.periodo", message },
        });
        return;
      }

      let newDefinicion: DefinicionIndicador;
      try {
        newDefinicion = parseDefinicionIndicador(body.definicion);
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : "Validation error";
        res.status(422).json({
          detail: { field: "definicion", message },
        });
        return;
      }

      // Fetch latest version for comparison
      const latestVersion = await IndicadorVersion.findOne({
        where: { indicador_id: indicador.id },
        order: [["version", "DESC"]],
      });

      // Normalize both for order-insensitive comparison
      const incoming = JSON.stringify(
        newDefinicion,
        Object.keys(newDefinicion as Record<string, unknown>).sort(),
      );

      let existing: string | null = null;
      if (latestVersion) {
        try {
          const parsed = parseDefinicionIndicador(latestVersion.definicion);
          existing = JSON.stringify(
            parsed,
            Object.keys(parsed as Record<string, unknown>).sort(),
          );
        } catch {
          existing = null;
        }
      }

      if (incoming !== existing) {
        // Validate location UUIDs against OpenMRS
        try {
          const unknownUuids = await validarDefinicionLocationUuids(newDefinicion);
          if (unknownUuids.length > 0) {
            res.status(422).json({
              detail: {
                field: "location_uuids",
                unknown_uuids: unknownUuids,
              },
            });
            return;
          }
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : "OpenMRS no disponible";
          res.status(502).json({ detail: message });
          return;
        }

        // Compute next version number
        const maxVersion: number | null = await IndicadorVersion.max("version", {
          where: { indicador_id: indicador.id },
        });

        const nextVersion = (maxVersion ?? 0) + 1;

        await IndicadorVersion.create({
          id: uuidv4(),
          indicador_id: indicador.id,
          version: nextVersion,
          definicion: newDefinicion as unknown as Record<string, unknown>,
          creado_en: new Date(),
        });
      }
    }

    // Always update metadata
    await indicador.update({
      nombre: body.nombre.trim(),
      descripcion: body.descripcion ?? null,
    });

    res.json(indicador.toJSON());
  }),
);

// ── DELETE /indicadores/:id ────────────────────────────────────────────────

indicadoresRouter.delete(
  "/:id",
  asyncHandler(async (req: Request, res: Response) => {
    const id = req.params["id"] as string;
    const indicador = await Indicador.findByPk(id);
    if (!indicador) {
      res.status(404).json({ detail: "Indicador no encontrado" });
      return;
    }

    await indicador.update({ activo: false });
    res.status(204).send();
  }),
);

// ── POST /indicadores/:id/versiones ────────────────────────────────────────

indicadoresRouter.post(
  "/:id/versiones",
  asyncHandler(async (req: Request, res: Response) => {
    await handleCreateVersion(req, res);
  }),
);

// ── GET /indicadores/:id/preview-sql ───────────────────────────────────────

indicadoresRouter.get(
  "/:id/preview-sql",
  asyncHandler(async (req: Request, res: Response) => {
    await handlePreviewSql(req, res);
  }),
);
