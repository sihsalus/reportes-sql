/**
 * Metas router — CRUD for annual targets (metas) on indicator versions.
 *
 * - PUT    /metas  → upsert meta for a version+year
 * - GET    /metas  → fetch meta by version+year or indicator+year
 * - DELETE /metas  → delete meta for a version+year
 */

import { Router, type Request, type Response } from "express";
import { QueryTypes } from "sequelize";
import { IndicadorVersion, IndicadorMeta } from "../models/indicador.js";
import { sequelize } from "../database/postgres.js";
import {
  MetaUpsertSchema,
  MetaQuerySchema,
  MetaDeleteSchema,
} from "../types/meta.js";
import { ZodError } from "zod";
import { asyncHandler } from "../middleware/async-handler.js";

export const metasRouter: Router = Router();

// ── PUT /metas ──────────────────────────────────────────────────────────

metasRouter.put(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    let body;
    try {
      body = MetaUpsertSchema.parse(req.body);
    } catch (err: unknown) {
      if (err instanceof ZodError) {
        const first = err.issues[0];
        const field = first?.path?.[0] ?? "unknown";
        res.status(422).json({
          detail: { field, message: first?.message ?? "Validation error" },
        });
        return;
      }
      throw err;
    }

    // Verify indicador_version_id exists
    const version = await IndicadorVersion.findOne({
      where: { id: body.indicador_version_id },
    });
    if (!version) {
      res.status(422).json({
        detail: {
          field: "indicador_version_id",
          message: "indicador_version_id not found",
        },
      });
      return;
    }

    // Upsert via raw SQL with ON CONFLICT
    const rows = await sequelize.query<{
      id: string;
      indicador_version_id: string;
      anio: number;
      valor_meta: string;
      creado_en: Date;
    }>(
      `INSERT INTO indicador_meta (id, indicador_version_id, anio, valor_meta, creado_en)
       VALUES (gen_random_uuid(), :indicador_version_id, :anio, :valor_meta, NOW())
       ON CONFLICT (indicador_version_id, anio)
       DO UPDATE SET valor_meta = EXCLUDED.valor_meta, creado_en = NOW()
       RETURNING id, indicador_version_id, anio, valor_meta::float8, creado_en`,
      {
        replacements: {
          indicador_version_id: body.indicador_version_id,
          anio: body.anio,
          valor_meta: body.valor_meta,
        },
        type: QueryTypes.SELECT,
      },
    );

    res.status(200).json(rows[0]);
  }),
);

// ── GET /metas ──────────────────────────────────────────────────────────

metasRouter.get(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    let query;
    try {
      query = MetaQuerySchema.parse(req.query);
    } catch (err: unknown) {
      if (err instanceof ZodError) {
        const first = err.issues[0];
        const field = first?.path?.[0] ?? "unknown";
        res.status(422).json({
          detail: { field, message: first?.message ?? "Validation error" },
        });
        return;
      }
      throw err;
    }

    let versionId: string;

    if (query.indicador_version_id) {
      versionId = query.indicador_version_id;
    } else {
      // Resolve latest active version for indicador_id
      const [latestVersion] = await sequelize.query<{ id: string }>(
        `SELECT iv.id
         FROM indicador_version iv
         JOIN indicador i ON i.id = iv.indicador_id
         WHERE iv.indicador_id = :indicador_id AND i.activo = true
         ORDER BY iv.version DESC
         LIMIT 1`,
        {
          replacements: { indicador_id: query.indicador_id },
          type: QueryTypes.SELECT,
        },
      );

      if (!latestVersion) {
        res.status(404).json({
          detail: {
            field: "indicador_id",
            message: "No se encontró una versión activa para el indicador",
          },
        });
        return;
      }
      versionId = latestVersion.id;
    }

    const [meta] = await sequelize.query<{
      id: string;
      indicador_version_id: string;
      anio: number;
      valor_meta: string;
      creado_en: Date;
      indicador_nombre: string;
      version_numero: number;
    }>(
      `SELECT m.id,
              m.indicador_version_id,
              m.anio,
              m.valor_meta::float8,
              m.creado_en,
              i.nombre AS indicador_nombre,
              iv.version AS version_numero
       FROM indicador_meta m
       JOIN indicador_version iv ON iv.id = m.indicador_version_id
       JOIN indicador i ON i.id = iv.indicador_id
       WHERE m.indicador_version_id = :versionId
         AND m.anio = :anio`,
      {
        replacements: { versionId, anio: query.anio },
        type: QueryTypes.SELECT,
      },
    );

    if (!meta) {
      res.status(404).json({
        detail: {
          field: "indicador_version_id",
          message: "Meta no encontrada",
        },
      });
      return;
    }

    res.status(200).json({
      id: meta.id,
      indicador_version_id: meta.indicador_version_id,
      anio: meta.anio,
      valor_meta: parseFloat(String(meta.valor_meta)),
      creado_en: meta.creado_en,
      indicador_nombre: meta.indicador_nombre,
      version_numero: meta.version_numero,
    });
  }),
);

// ── DELETE /metas ────────────────────────────────────────────────────────

metasRouter.delete(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    let query;
    try {
      query = MetaDeleteSchema.parse(req.query);
    } catch (err: unknown) {
      if (err instanceof ZodError) {
        const first = err.issues[0];
        const field = first?.path?.[0] ?? "unknown";
        res.status(422).json({
          detail: { field, message: first?.message ?? "Validation error" },
        });
        return;
      }
      throw err;
    }

    const deleted = await IndicadorMeta.destroy({
      where: {
        indicador_version_id: query.indicador_version_id,
        anio: query.anio,
      },
    });

    if (deleted === 0) {
      res.status(404).json({
        detail: {
          field: "indicador_version_id",
          message: "Meta no encontrada",
        },
      });
      return;
    }

    res.status(204).send();
  }),
);
