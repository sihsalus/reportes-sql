/**
 * POST /indicadores/:id/versiones — create new immutable indicator version.
 *
 * Auto-copies metas from the previous version (non-fatal on failure).
 * Returns 409 Conflict on race-condition duplicate version creation.
 */
import type { Request, Response } from "express";
import { Indicador, IndicadorVersion } from "../../models/indicador.js";
import { sequelize } from "../../database/postgres.js";
import type { DefinicionIndicador } from "../../types/definicion.js";
import {
  createIndicatorVersion,
  parseRegistrationDefinition,
  PeriodRejectedError,
  nextVersion as fetchNextVersion,
  UnknownUuidsError,
  validateRegistrationUuids,
} from "../../indicators/registration.js";
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

  const body = req.body;
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    res.status(422).json({
      detail: {
        field: "definicion",
        message: "definicion es obligatorio",
      },
    });
    return;
  }

  const typedBody = body as { definicion?: unknown };
  if (!typedBody.definicion) {
    res.status(422).json({
      detail: {
        field: "definicion",
        message: "definicion es obligatorio",
      },
    });
    return;
  }

  // Shared parse + OpenMRS validation via the service (same rules as
  // POST / and the startup catalog). HTTP mapping only.
  let definicion: DefinicionIndicador;
  try {
    definicion = parseRegistrationDefinition(typedBody.definicion);
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

  const nextVersion = await fetchNextVersion(indicador.id);

  try {
    const nuevaVersion = await createIndicatorVersion(
      indicador.id,
      nextVersion,
      definicion,
    );

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
