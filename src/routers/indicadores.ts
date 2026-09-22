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

import { isDeepStrictEqual } from "node:util";
import { sequelize } from "../database/postgres.js";
import { Router, type Request, type Response } from "express";
import { v4 as uuidv4 } from "uuid";
import { ZodError } from "zod";
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
  IndicadorCreateSchema,
  IndicadorUpdateSchema,
} from "../types/indicador.js";
import {
  validarDefinicionLocationUuids,
  validarDefinicionEncounterTypeUuids,
} from "../validators/openmrs.js";
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

    // Reject inbound periodo (breaking contract change)
    try {
      rejectPeriodoInPayload(body.definicion);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Validation error";
      res.status(422).json({
        detail: { field: "definicion.periodo", message },
      });
      return;
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

    // Validate encounter_type_uuids exist in OpenMRS before DB write.
    try {
      const unknownUuids = await validarDefinicionEncounterTypeUuids(definicion);
      if (unknownUuids.length > 0) {
        res.status(422).json({
          detail: {
            field: "encounter_type_uuids",
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

    await sequelize.transaction(async (transaction) => {
      await Indicador.create({
        id: indicadorId,
        nombre: body.nombre.trim(),
        descripcion: body.descripcion ?? null,
        activo: true,
        creado_en: now,
      }, { transaction });

      await IndicadorVersion.create({
        id: uuidv4(),
        indicador_id: indicadorId,
        version: 1,
        definicion: definicion as unknown as Record<string, unknown>,
        creado_en: now,
      }, { transaction });
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

    let versionToCreate: { version: number; definicion: Record<string, unknown> } | undefined;

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

      // Compare the full parsed structure, including nested filters.
      let existing: DefinicionIndicador | null = null;
      if (latestVersion) {
        try {
          existing = parseDefinicionIndicador(latestVersion.definicion);
        } catch {
          existing = null;
        }
      }

      if (!isDeepStrictEqual(newDefinicion, existing)) {
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

        try {
          const unknownUuids = await validarDefinicionEncounterTypeUuids(newDefinicion);
          if (unknownUuids.length > 0) {
            res.status(422).json({
              detail: { field: "encounter_type_uuids", unknown_uuids: unknownUuids },
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

        versionToCreate = {
          version: nextVersion,
          definicion: newDefinicion as unknown as Record<string, unknown>,
        };
      }
    }

    // A failed version or metadata write must not leave a partial edit.
    await sequelize.transaction(async (transaction) => {
      if (versionToCreate) {
        await IndicadorVersion.create({
          id: uuidv4(),
          indicador_id: indicador.id,
          ...versionToCreate,
          creado_en: new Date(),
        }, { transaction });
      }
      await indicador.update({
        nombre: body.nombre.trim(),
        descripcion: body.descripcion ?? null,
      }, { transaction });
    });

    res.json(indicador.toJSON());
  }),
);

// ── DELETE /indicadores/:id ────────────────────────────────────────────────

indicadoresRouter.delete(
  "/:id",
  requirePrivilege(settings.openmrs_required_privilege),
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
