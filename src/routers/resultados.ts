/**
 * Resultados router — query and trigger indicator calculations.
 *
 * - GET  /resultados?indicador_id=X&periodo_inicio=...&periodo_fin=...
 *        → filterable, paginated list of pre-computed results.
 * - POST /resultados/calcular-ahora
 *        → iterate all active indicators, compute their periodo dates,
 *          run engine/interpreter + executor, return batch summary.
 */

import { Router, type Request, type Response } from "express";
import { Op } from "sequelize";
import {
  Indicador,
  IndicadorVersion,
  IndicadorResultado,
} from "../models/indicador.js";
import { parseDefinicionIndicador } from "../types/definicion.js";
import { buildQuery } from "../engine/interpreter.js";
import { executeAndPersist } from "../engine/executor.js";
import { calcularPeriodo } from "../engine/periodo.js";
import { resolveConceptMap } from "../validators/openmrs.js";

export const resultadosRouter: Router = Router();

// ── Helper: async handler wrapper ──────────────────────────────────────

function asyncHandler(
  fn: (req: Request, res: Response) => Promise<void>,
) {
  return (req: Request, res: Response) => {
    fn(req, res).catch((err: unknown) => {
      console.error("Unhandled error in resultados router:", err);
      res.status(500).json({
        detail: "Error interno del servidor",
      });
    });
  };
}

// ── GET /resultados ────────────────────────────────────────────────────

resultadosRouter.get(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    const indicadorId = req.query["indicador_id"] as string | undefined;
    const periodoInicioStr = req.query["periodo_inicio"] as string | undefined;
    const periodoFinStr = req.query["periodo_fin"] as string | undefined;
    const page = Math.max(1, parseInt((req.query["page"] as string) ?? "1", 10) || 1);
    const size = Math.min(100, Math.max(1, parseInt((req.query["size"] as string) ?? "20", 10) || 20));

    // Build where clause
    const where: Record<string, unknown> = {};
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

// ── POST /resultados/calcular-ahora ────────────────────────────────────

resultadosRouter.post(
  "/calcular-ahora",
  asyncHandler(async (_req: Request, res: Response) => {
    const indicadores = await Indicador.findAll({
      where: { activo: true },
    });

    let calculados = 0;
    const errores: Array<{
      indicador_id: string;
      indicador_nombre: string;
      error: string;
    }> = [];
    const total = indicadores.length;

    for (const indicador of indicadores) {
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
          continue;
        }

        // Parse definicion and compute period
        const definicion = parseDefinicionIndicador(latest.definicion);
        const [periodoInicio, periodoFin] = calcularPeriodo(
          definicion.periodo,
        );

        // Resolve ordenes concept UUIDs to OpenMRS concept_ids
        let conceptMap: Record<string, number> | null = null;
        const ordenes = definicion.evento?.ordenes;
        if (ordenes && ordenes.length > 0) {
          const uuids = ordenes.map((f) => f.concepto_uuid);
          try {
            const resolved = await resolveConceptMap(uuids);
            conceptMap = {};
            const missing: string[] = [];
            for (const f of ordenes) {
              const cid = resolved[f.concepto_uuid];
              if (cid !== undefined) {
                conceptMap[f.concepto_uuid] = cid;
              } else {
                missing.push(f.concepto_uuid);
              }
            }
            if (missing.length > 0) {
              throw new Error(
                `Conceptos de órdenes no encontrados: ${missing.join(", ")}`,
              );
            }
          } catch (err: unknown) {
            const message =
              err instanceof Error ? err.message : "Error resolviendo conceptos";
            throw new Error(message);
          }
        }

        // Build query and execute
        const { sql, params } = buildQuery(
          definicion,
          periodoInicio,
          periodoFin,
          conceptMap,
        );

        await executeAndPersist(
          sql,
          params as Record<string, unknown>,
          latest.id,
          periodoInicio,
          periodoFin,
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
      }
    }

    res.json({
      calculados,
      errores,
      total,
    });
  }),
);
