/**
 * Resultados router — query and trigger indicator calculations.
 *
 * - GET  /resultados?indicador_id=X&periodo_inicio=...&periodo_fin=...
 *        → filterable, paginated list of pre-computed results; by default
 *          only canonical rows are returned, include_historicos=true also
 *          returns superseded rows, version_id filters by specific version.
 * - GET  /resultados/series?indicador_id=X&anio=YYYY&granularity=mensual|...
 *        → time-series rollups from canonical monthly results.
 * - POST /resultados/calcular-ahora
 *        → iterate all active indicators, calculate for the current month,
 *          run engine/interpreter + executor with canonical semantics, return batch summary.
 * - POST /resultados/recalcular-anio
 *        → recalculate all active indicators for every month in a given year.
 */

import { Router, type Request, type Response } from "express";
import { Op } from "sequelize";
import {
  Indicador,
  IndicadorVersion,
  IndicadorResultado,
  IndicadorCalculoLog,
} from "../models/indicador.js";
import { parseDefinicionIndicador } from "../types/definicion.js";
import { buildQuery } from "../engine/interpreter.js";
import { executeAndPersist } from "../engine/executor.js";
import { queryMysql } from "../database/mysql.js";
import { calcularMesActual } from "../engine/periodo.js";
import { resolveOrcenesConceptMap } from "../engine/concept-resolver.js";
import { asyncHandler } from "../middleware/async-handler.js";
import { rateLimit, resetRateLimitStore } from "./resultados/rate-limit.js";
import { handleSeries } from "./resultados/series.js";
import { handleRecalcularAnio } from "./resultados/recalcular-anio.js";

export const resultadosRouter: Router = Router();

// Re-export for testing
export { resetRateLimitStore };

/**
 * Best-effort ledger write for a failed calculation. Must never mask the
 * original error, so the create is wrapped in a silent try/catch.
 */
async function tryLogCalculoError(entry: {
  indicador_id: string;
  indicador_version_id: string | null;
  mes_referencia: Date;
  error: string;
  fuente: string;
}): Promise<void> {
  try {
    await IndicadorCalculoLog.create({
      status: "error",
      indicador_id: entry.indicador_id,
      indicador_version_id: entry.indicador_version_id,
      mes_referencia: entry.mes_referencia,
      filas_devueltas: null,
      filas_persistidas: null,
      duracion_ms: null,
      error: entry.error,
      fuente: entry.fuente,
      creado_en: new Date(),
    });
  } catch {
    // Ledger must not mask the original error.
  }
}

// ── GET /resultados ────────────────────────────────────────────────────────

resultadosRouter.get(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    const indicadorId = req.query["indicador_id"] as string | undefined;
    const periodoInicioStr = req.query["periodo_inicio"] as string | undefined;
    const periodoFinStr = req.query["periodo_fin"] as string | undefined;
    const versionId = req.query["version_id"] as string | undefined;
    const includeHistoricos = req.query["include_historicos"] === "true";
    const pageRaw = req.query["page"] as string | undefined;
    const sizeRaw = req.query["size"] as string | undefined;

    let page = 1;
    let size = 20;

    if (pageRaw !== undefined && pageRaw !== "") {
      if (!/^\d+$/.test(pageRaw)) {
        res.status(422).json({
          detail: { field: "page", message: "page debe ser un número entero" },
        });
        return;
      }
      page = parseInt(pageRaw, 10);
      if (page < 1) {
        res.status(422).json({
          detail: { field: "page", message: "page debe ser mayor o igual a 1" },
        });
        return;
      }
    }

    if (sizeRaw !== undefined && sizeRaw !== "") {
      if (!/^\d+$/.test(sizeRaw)) {
        res.status(422).json({
          detail: { field: "size", message: "size debe ser un número entero" },
        });
        return;
      }
      size = parseInt(sizeRaw, 10);
      if (size < 1 || size > 100) {
        res.status(422).json({
          detail: { field: "size", message: "size debe estar entre 1 y 100" },
        });
        return;
      }
    }

    if (
      versionId !== undefined &&
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(versionId)
    ) {
      res.status(422).json({
        detail: { field: "version_id", message: "version_id debe ser un UUID válido" },
      });
      return;
    }

    // Build where clause. Default: canonical rows only (one per
    // indicador+month); include_historicos=true also returns superseded rows.
    const where: Record<string, unknown> = {};
    if (!includeHistoricos) {
      where["es_canonico"] = true;
    }
    if (versionId) {
      where["indicador_version_id"] = versionId;
    }
    if (periodoInicioStr) {
      where["periodo_inicio"] = { [Op.gte]: periodoInicioStr };
    }
    if (periodoFinStr) {
      where["periodo_fin"] = { [Op.lte]: periodoFinStr };
    }

    // If indicador_id is provided, filter through IndicadorVersion
    let includeOption: object | undefined;
    if (indicadorId) {
      includeOption = {
        model: IndicadorVersion,
        as: "indicador_version",
        where: { indicador_id: indicadorId },
        include: [
          {
            model: Indicador,
            as: "indicador",
          },
        ],
      };
    } else {
      includeOption = {
        model: IndicadorVersion,
        as: "indicador_version",
        include: [
          {
            model: Indicador,
            as: "indicador",
          },
        ],
      };
    }

    const { count, rows } = await IndicadorResultado.findAndCountAll({
      where,
      include: [includeOption as object].filter(Boolean),
      order: [["calculado_en", "DESC"]],
      offset: (page - 1) * size,
      limit: size,
    });

    const pages = Math.max(1, Math.ceil(count / size));

    const items = rows.map((r) => ({
      id: r.id,
      indicador_version_id: r.indicador_version_id,
      periodo_inicio: r.periodo_inicio,
      periodo_fin: r.periodo_fin,
      valor: parseFloat(String(r.valor)),
      calculado_en: r.calculado_en,
      mes_referencia: r.mes_referencia,
      es_canonico: r.es_canonico,
      indicador_nombre:
        (r as unknown as { indicador_version?: { indicador?: { nombre: string } } })
          .indicador_version?.indicador?.nombre ?? null,
      indicador_version_num:
        (r as unknown as { indicador_version?: { version: number } })
          .indicador_version?.version ?? null,
    }));

    res.json({
      items,
      total: count,
      page,
      size,
      pages,
    });
  }),
);

// ── GET /resultados/series ─────────────────────────────────────────────────

resultadosRouter.get(
  "/series",
  asyncHandler(async (req: Request, res: Response) => {
    await handleSeries(req, res);
  }),
);

// ── POST /resultados/calcular-ahora ────────────────────────────────────────

resultadosRouter.post(
  "/calcular-ahora",
  asyncHandler(async (req: Request, res: Response) => {
    const clientIp = req.ip ?? req.socket.remoteAddress ?? "unknown";
    if (!rateLimit(`calcular-ahora:${clientIp}`, 3, 60_000)) {
      res.status(429).json({
        detail: "Demasiadas solicitudes. Intentá de nuevo en un minuto.",
      });
      return;
    }

    // Preflight: fail fast with 502 when the OpenMRS MySQL database is
    // unreachable, instead of returning a 200 with every indicator errored.
    try {
      await queryMysql("SELECT 1", {});
    } catch {
      res.status(502).json({ detail: "OpenMRS no disponible" });
      return;
    }

    const indicadores = await Indicador.findAll({
      where: { activo: true },
    });

    // Always calculate for the current month (canonical monthly semantics)
    const { inicio, fin, mes_referencia } = calcularMesActual();

    let calculados = 0;
    const errores: Array<{
      indicador_id: string;
      indicador_nombre: string;
      error: string;
    }> = [];
    const total = indicadores.length;

    for (const indicador of indicadores) {
      let latestVersionId: string | null = null;
      try {
        // Get latest version
        const latest = await IndicadorVersion.findOne({
          where: { indicador_id: indicador.id },
          order: [["version", "DESC"]],
        });

        if (!latest) {
          errores.push({
            indicador_id: indicador.id,
            indicador_nombre: indicador.nombre,
            error: "Sin versiones definidas",
          });
          await tryLogCalculoError({
            indicador_id: indicador.id,
            indicador_version_id: null,
            mes_referencia,
            error: "Sin versiones definidas",
            fuente: "calcular-ahora",
          });
          continue;
        }
        latestVersionId = latest.id;

        // Parse definicion (no longer uses periodo)
        const definicion = parseDefinicionIndicador(latest.definicion);

        // Resolve ordenes concept UUIDs to OpenMRS concept_ids
        const ordenes = definicion.evento?.ordenes;
        const conceptMap = ordenes && ordenes.length > 0
          ? await resolveOrcenesConceptMap(ordenes)
          : null;

        // Build query with month boundaries
        const { sql, params } = buildQuery(
          definicion,
          inicio,
          fin,
          conceptMap,
        );

        await executeAndPersist(
          sql,
          params as Record<string, unknown>,
          latest.id,
          inicio,
          fin,
          mes_referencia,
          {
            indicadorId: indicador.id,
            fuente: "calcular-ahora",
            persistirCeroSiVacio: true,
          },
        );

        calculados += 1;
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : "Error desconocido";
        errores.push({
          indicador_id: indicador.id,
          indicador_nombre: indicador.nombre,
          error: message,
        });
        await tryLogCalculoError({
          indicador_id: indicador.id,
          indicador_version_id: latestVersionId,
          mes_referencia,
          error: message,
          fuente: "calcular-ahora",
        });
      }
    }

    res.json({
      calculados,
      errores,
      total,
      mes_referencia: mes_referencia.toISOString().slice(0, 7),
    });
  }),
);

// ── POST /resultados/recalcular-anio ───────────────────────────────────────

resultadosRouter.post(
  "/recalcular-anio",
  asyncHandler(async (req: Request, res: Response) => {
    await handleRecalcularAnio(req, res);
  }),
);
