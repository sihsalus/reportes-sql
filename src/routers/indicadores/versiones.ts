/**
 * POST /indicadores/:id/versiones — create new immutable indicator version.
 *
 * Auto-copies metas from the previous version (non-fatal on failure).
 * Returns 409 Conflict on race-condition duplicate version creation.
 */
import type { Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import { Indicador, IndicadorVersion } from "../../models/indicador.js";
import { sequelize } from "../../database/postgres.js";
import {
  parseDefinicionIndicador,
  rejectPeriodoInPayload,
  type DefinicionIndicador,
} from "../../types/definicion.js";
import { validarDefinicionLocationUuids } from "../../validators/openmrs.js";
import { logger } from "../../config/logger.js";

export async function handleCreateVersion(
  req: Request,
  res: Response,
): Promise<void> {
  const id = req.params["id"] as string;
  const indicador = await Indicador.findByPk(id);
  if (!indicador) {
    res.status(404).json({ detail: "Indicador no encontrado" });
    return;
  }

  const body = req.body as { definicion?: unknown };
  if (!body.definicion) {
    res.status(422).json({
      detail: {
        field: "definicion",
        message: "definicion es obligatorio",
      },
    });
    return;
  }

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

  // Validate location_uuids against OpenMRS
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

  const maxVersion: number | null = await IndicadorVersion.max("version", {
    where: { indicador_id: indicador.id },
  });
  const nextVersion = (maxVersion ?? 0) + 1;

  try {
    const nuevaVersion = await IndicadorVersion.create({
      id: uuidv4(),
      indicador_id: indicador.id,
      version: nextVersion,
      definicion: definicion as unknown as Record<string, unknown>,
      creado_en: new Date(),
    });

    // Auto-copy metas from previous version (non-fatal)
    try {
      const previousVersion = await IndicadorVersion.findOne({
        where: { indicador_id: indicador.id, version: nextVersion - 1 },
        attributes: ["id"],
      });
      if (previousVersion) {
        await sequelize.query(
          `INSERT INTO indicador_meta (id, indicador_version_id, anio, valor_meta, creado_en)
           SELECT gen_random_uuid(), :newVersionId, anio, valor_meta, NOW()
           FROM indicador_meta
           WHERE indicador_version_id = :oldVersionId
           ON CONFLICT (indicador_version_id, anio) DO NOTHING`,
          {
            replacements: {
              newVersionId: nuevaVersion.id,
              oldVersionId: previousVersion.id,
            },
          },
        );
      }
    } catch (copyErr) {
      logger.warn("Failed to auto-copy metas to new version", {
        error: String(copyErr),
      });
    }

    res.status(201).json(nuevaVersion.toJSON());
  } catch (err: unknown) {
    // UNIQUE constraint violation → 409 Conflict
    const message = err instanceof Error ? err.message : "";
    if (
      message.includes("duplicate") ||
      message.includes("unique") ||
      message.includes("violates")
    ) {
      res.status(409).json({
        detail:
          "Conflicto de versión — otro proceso creó la misma versión. Intente nuevamente.",
      });
      return;
    }
    throw err;
  }
}
