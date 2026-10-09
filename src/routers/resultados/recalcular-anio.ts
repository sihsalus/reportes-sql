/**
 * POST /resultados/recalcular-anio handler — annual recalculation.
 *
 * Validates the request, resolves the target indicators, and delegates the
 * batch to the shared calculation service (`engine/batch`). Only the
 * transport concerns (rate limit, input validation, HTTP status mapping)
 * live here; the response contract is unchanged.
 */
import type { Request, Response } from "express";
import { Indicador } from "../../models/indicador.js";
import { OpenMRSUnavailableError } from "../../errors.js";
import { recalcularAnio, type RecalcularAnioResultado } from "../../engine/batch.js";
import { rateLimit } from "./rate-limit.js";
import { parseNumericId } from "../parse-id.js";

export async function handleRecalcularAnio(
  req: Request,
  res: Response,
): Promise<void> {
  const clientIp = req.ip ?? req.socket.remoteAddress ?? "unknown";
  if (!rateLimit(`recalcular-anio:${clientIp}`, 2, 300_000)) {
    res.status(429).json({
      detail: "Demasiadas solicitudes. Intentá de nuevo en 5 minutos.",
    });
    return;
  }

  const body = req.body;
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    res.status(422).json({
      detail: { field: "anio", message: "anio debe ser un número entero" },
    });
    return;
  }

  const { anio, indicador_id } = body as {
    anio?: number;
    indicador_id?: number | string;
  };

  let indicadorId: number | undefined;
  if (indicador_id !== undefined && indicador_id !== null) {
    const parsed =
      typeof indicador_id === "number" ? indicador_id : parseNumericId(indicador_id);
    if (parsed === null || !Number.isInteger(parsed) || parsed <= 0) {
      res.status(422).json({
        detail: { field: "indicador_id", message: "indicador_id debe ser un id numérico" },
      });
      return;
    }
    indicadorId = parsed;
  }

  if (typeof anio !== "number" || !Number.isInteger(anio)) {
    res.status(422).json({
      detail: { field: "anio", message: "anio debe ser un número entero" },
    });
    return;
  }

  const currentYear = new Date().getUTCFullYear();

  // Lower bound: stays consistent with `/resultados/series` (2000-2100).
  // Recalculating pre-2000 is meaningless for clinical indicators and would
  // produce unbounded batch sizes.
  if (anio < 2000) {
    res.status(422).json({
      detail: { field: "anio", message: "anio debe ser un año realista (>= 2000)" },
    });
    return;
  }

  if (anio > currentYear) {
    res.status(422).json({
      detail: { field: "anio", message: "No se puede recalcular un año futuro" },
    });
    return;
  }

  let indicadores;
  if (indicadorId) {
    indicadores = await Indicador.findAll({ where: { id: indicadorId } });
    if (indicadores.length === 0) {
      res.status(422).json({
        detail: { field: "indicador_id", message: "Indicador no encontrado" },
      });
      return;
    }
  } else {
    indicadores = await Indicador.findAll({ where: { activo: true } });
  }

  let result: RecalcularAnioResultado;
  try {
    result = await recalcularAnio(indicadores, anio);
  } catch (err) {
    if (err instanceof OpenMRSUnavailableError) {
      res.status(502).json({ detail: err.message });
      return;
    }
    throw err;
  }

  res.json({
    anio,
    indicador_id: indicadorId ?? null,
    meses_procesados: result.meses_procesados,
    indicadores_considerados: indicadores.length,
    recalculados: result.recalculados,
    errores: result.errores,
    total: result.total,
  });
}
