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
import { ZodError } from "zod";
import {
  Indicador,
  IndicadorVersion,
  IndicadorResultado,
} from "../models/indicador.js";
import {
  parseDefinicionIndicador,
  type DefinicionIndicador,
} from "../types/definicion.js";
import {
  IndicadorCreateSchema,
  IndicadorUpdateSchema,
} from "../types/indicador.js";
import {
  createIndicatorWithVersion,
  createIndicatorVersion,
  parseRegistrationDefinition,
  PeriodRejectedError,
  nextVersion as fetchNextVersion,
  UnknownUuidsError,
  validateRegistrationUuids,
} from "../indicators/registration.js";
import { asyncHandler } from "../middleware/async-handler.js";
import { requirePrivilege } from "../middleware/auth.js";
import { handleCreateVersion } from "./indicadores/versiones.js";
import { handlePreviewSql } from "./indicadores/preview-sql.js";
import { settings } from "../config/index.js";

export const indicadoresRouter: Router = Router();

// ── POST /indicadores ──────────────────────────────────────────────────────

indicadoresRouter.post(
  "/",
  requirePrivilege(settings.openmrs_required_privilege),
  asyncHandler(async (req: Request, res: Response) => {
    let body;
    try {
      body = IndicadorCreateSchema.parse(req.body);
    } catch (err: unknown) {
      if (err instanceof ZodError) {
        const first = err.issues[0];
        const field =
          first && first.path.length > 0
            ? String(first.path[first.path.length - 1])
            : "nombre";
        res.status(422).json({
          detail: { field, message: first?.message ?? "Validation error" },
        });
        return;
      }
      throw err;
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

    // Parse + OpenMRS-validate + persist via the shared registration
    // service (same rules as the startup catalog, periodo rejection
    // included). HTTP mapping only.
    let definicion: DefinicionIndicador;
    try {
      definicion = parseRegistrationDefinition(body.definicion);
    } catch (err: unknown) {
      if (err instanceof PeriodRejectedError) {
        res.status(422).json({
          detail: { field: err.field, message: err.message },
        });
        return;
      }
      const message =
        err instanceof Error ? err.message : "Validation error";
      res.status(422).json({
        detail: { field: "definicion", message },
      });
      return;
    }

    try {
      await validateRegistrationUuids(definicion);
    } catch (err: unknown) {
      if (err instanceof UnknownUuidsError) {
        res.status(422).json({
          detail: {
            field: err.field,
            unknown_uuids: err.unknown_uuids,
          },
        });
        return;
      }
      const message = err instanceof Error ? err.message : "OpenMRS no disponible";
      res.status(502).json({ detail: message });
      return;
    }

    const { indicador } = await createIndicatorWithVersion({
      nombre: body.nombre.trim(),
      descripcion: body.descripcion ?? null,
      activo: true,
      definicion,
    });

    const created = await Indicador.findByPk(indicador.id);
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
  requirePrivilege(settings.openmrs_required_privilege),
  asyncHandler(async (req: Request, res: Response) => {
    const id = req.params["id"] as string;
    const indicador = await Indicador.findByPk(id);
    if (!indicador) {
      res.status(404).json({ detail: "Indicador no encontrado" });
      return;
    }

    let body;
    try {
      body = IndicadorUpdateSchema.parse(req.body);
    } catch (err: unknown) {
      if (err instanceof ZodError) {
        const first = err.issues[0];
        const field =
          first && first.path.length > 0
            ? String(first.path[first.path.length - 1])
            : "nombre";
        res.status(422).json({
          detail: { field, message: first?.message ?? "Validation error" },
        });
        return;
      }
      throw err;
    }

    // ── Auto-versioning when definicion is present ──
    if (body.definicion != null) {
      // Shared parse (periodo rejection + shape) via the service.
      let newDefinicion: DefinicionIndicador;
      try {
        newDefinicion = parseRegistrationDefinition(body.definicion);
      } catch (err: unknown) {
        if (err instanceof PeriodRejectedError) {
          res.status(422).json({
            detail: { field: err.field, message: err.message },
          });
          return;
        }
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
        // Same shared validation as POST / catalog (locations,
        // encounter types, diagnosticos) before versioning.
        try {
          await validateRegistrationUuids(newDefinicion);
        } catch (err: unknown) {
          if (err instanceof UnknownUuidsError) {
            res.status(422).json({
              detail: {
                field: err.field,
                unknown_uuids: err.unknown_uuids,
              },
            });
            return;
          }
          const message = err instanceof Error ? err.message : "OpenMRS no disponible";
          res.status(502).json({ detail: message });
          return;
        }

        const nextVersion = await fetchNextVersion(indicador.id);
        await createIndicatorVersion(indicador.id, nextVersion, newDefinicion);
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
  requirePrivilege(settings.openmrs_required_privilege),
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
