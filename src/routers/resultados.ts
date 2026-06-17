/**
 * Resultados router — query and trigger indicator calculations.
 *
 * - GET  /resultados?indicador_id=X&periodo_inicio=...&periodo_fin=...
 *        → filterable, paginated list of pre-computed results.
 * - GET  /resultados/series?indicador_id=X&anio=YYYY&granularity=mensual|...
 *        → time-series rollups from canonical monthly results.
 * - POST /resultados/calcular-ahora
 *        → iterate all active indicators, calculate for the current month,
 *          run engine/interpreter + executor with canonical semantics, return batch summary.
 */

import { Router, type Request, type Response } from "express";
import { Op, QueryTypes } from "sequelize";
import {
  Indicador,
  IndicadorVersion,
  IndicadorResultado,
} from "../models/indicador.js";
import { sequelize } from "../database/postgres.js";
import { parseDefinicionIndicador } from "../types/definicion.js";
import { buildQuery } from "../engine/interpreter.js";
import { executeAndPersist } from "../engine/executor.js";
import { calcularMesActual, calcularMesEspecifico } from "../engine/periodo.js";
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

// ── GET /resultados/series ─────────────────────────────────────────────

type Granularity = "mensual" | "trimestral" | "semestral" | "anual";

interface SeriesRow {
  periodo_label: string;
  valor: number;
  meses_disponibles: number;
  mes_referencia?: string;
  trimestre?: number;
  semestre?: number;
  anio: number;
}

const GRANULARITY_SQL: Record<Granularity, string> = {
  mensual: `
    SELECT
      TO_CHAR(mes_referencia, 'YYYY-MM') AS periodo_label,
      mes_referencia,
      EXTRACT(YEAR FROM mes_referencia)::int AS anio,
      SUM(valor)::numeric AS valor,
      COUNT(*)::int AS meses_disponibles
    FROM indicador_resultado ir
    JOIN indicador_version iv ON iv.id = ir.indicador_version_id
    WHERE iv.indicador_id = :indicador_id
      AND ir.es_canonico = true
      AND EXTRACT(YEAR FROM ir.mes_referencia) = :anio
    GROUP BY mes_referencia
    ORDER BY mes_referencia
  `,
  trimestral: `
    SELECT
      EXTRACT(YEAR FROM mes_referencia)::int AS anio,
      EXTRACT(QUARTER FROM mes_referencia)::int AS trimestre,
      'Q' || EXTRACT(QUARTER FROM mes_referencia)::int AS periodo_label,
      SUM(valor)::numeric AS valor,
      COUNT(*)::int AS meses_disponibles
    FROM indicador_resultado ir
    JOIN indicador_version iv ON iv.id = ir.indicador_version_id
    WHERE iv.indicador_id = :indicador_id
      AND ir.es_canonico = true
      AND EXTRACT(YEAR FROM ir.mes_referencia) = :anio
    GROUP BY EXTRACT(YEAR FROM mes_referencia), EXTRACT(QUARTER FROM mes_referencia)
    ORDER BY trimestre
  `,
  semestral: `
    SELECT
      EXTRACT(YEAR FROM mes_referencia)::int AS anio,
      CASE
        WHEN EXTRACT(MONTH FROM mes_referencia) <= 6 THEN 1 ELSE 2
      END AS semestre,
      'H' || CASE
        WHEN EXTRACT(MONTH FROM mes_referencia) <= 6 THEN 1 ELSE 2
      END AS periodo_label,
      SUM(valor)::numeric AS valor,
      COUNT(*)::int AS meses_disponibles
    FROM indicador_resultado ir
    JOIN indicador_version iv ON iv.id = ir.indicador_version_id
    WHERE iv.indicador_id = :indicador_id
      AND ir.es_canonico = true
      AND EXTRACT(YEAR FROM ir.mes_referencia) = :anio
    GROUP BY
      EXTRACT(YEAR FROM mes_referencia),
      CASE WHEN EXTRACT(MONTH FROM mes_referencia) <= 6 THEN 1 ELSE 2 END
    ORDER BY semestre
  `,
  anual: `
    SELECT
      EXTRACT(YEAR FROM mes_referencia)::int AS anio,
      TO_CHAR(mes_referencia, 'YYYY') AS periodo_label,
      SUM(valor)::numeric AS valor,
      COUNT(*)::int AS meses_disponibles
    FROM indicador_resultado ir
    JOIN indicador_version iv ON iv.id = ir.indicador_version_id
    WHERE iv.indicador_id = :indicador_id
      AND ir.es_canonico = true
      AND EXTRACT(YEAR FROM ir.mes_referencia) = :anio
    GROUP BY EXTRACT(YEAR FROM mes_referencia)
    ORDER BY anio
  `,
};

resultadosRouter.get(
  "/series",
  asyncHandler(async (req: Request, res: Response) => {
    const indicadorId = req.query["indicador_id"] as string | undefined;
    const anioStr = req.query["anio"] as string | undefined;
    const granularity = (req.query["granularity"] as string) || "mensual";

    if (!indicadorId) {
      res.status(422).json({
        detail: { field: "indicador_id", message: "indicador_id es obligatorio" },
      });
      return;
    }

    const anio = parseInt(anioStr ?? String(new Date().getUTCFullYear()), 10);
    if (isNaN(anio) || anio < 2000 || anio > 2100) {
      res.status(422).json({
        detail: { field: "anio", message: "anio debe ser un año válido (2000-2100)" },
      });
      return;
    }

    if (!["mensual", "trimestral", "semestral", "anual"].includes(granularity)) {
      res.status(422).json({
        detail: {
          field: "granularity",
          message: "granularity debe ser: mensual, trimestral, semestral, o anual",
        },
      });
      return;
    }

    const sql = GRANULARITY_SQL[granularity as Granularity];
    const rows = await sequelize.query<SeriesRow>(sql, {
      replacements: { indicador_id: indicadorId, anio },
      type: QueryTypes.SELECT,
    });

    // Map rows to a consistent shape
    const items = rows.map((r) => {
      const item: Record<string, unknown> = {
        periodo_label: r.periodo_label,
        valor: typeof r.valor === "string" ? parseFloat(String(r.valor)) : Number(r.valor),
        meses_disponibles: r.meses_disponibles,
        anio: r.anio,
      };

      if ("mes_referencia" in r && r.mes_referencia) {
        item["mes_referencia"] = r.mes_referencia;
      }
      if ("trimestre" in r && r.trimestre != null) {
        item["trimestre"] = r.trimestre;
      }
      if ("semestre" in r && r.semestre != null) {
        item["semestre"] = r.semestre;
      }

      return item;
    });

    res.json({
      items,
      indicador_id: indicadorId,
      anio,
      granularity,
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

        // Parse definicion (no longer uses periodo)
        const definicion = parseDefinicionIndicador(latest.definicion);

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
      mes_referencia: mes_referencia.toISOString().slice(0, 7),
    });
  }),
);

// ── POST /resultados/recalcular-anio ───────────────────────────────────

resultadosRouter.post(
  "/recalcular-anio",
  asyncHandler(async (req: Request, res: Response) => {
    const { anio, indicador_id } = req.body as {
      anio?: number;
      indicador_id?: string;
    };

    if (typeof anio !== "number" || !Number.isInteger(anio)) {
      res.status(422).json({
        detail: { field: "anio", message: "anio debe ser un número entero" },
      });
      return;
    }

    const hoy = new Date();
    const currentYear = hoy.getUTCFullYear();
    const currentMonth = hoy.getUTCMonth() + 1; // 1-indexed

    if (anio > currentYear) {
      res.status(422).json({
        detail: { field: "anio", message: "No se puede recalcular un año futuro" },
      });
      return;
    }

    let indicadores;
    if (indicador_id) {
      indicadores = await Indicador.findAll({ where: { id: indicador_id } });
      if (indicadores.length === 0) {
        res.status(422).json({
          detail: { field: "indicador_id", message: "Indicador no encontrado" },
        });
        return;
      }
    } else {
      indicadores = await Indicador.findAll({ where: { activo: true } });
    }

    const maxMes = anio === currentYear ? currentMonth : 12;
    const meses: number[] = [];
    for (let m = 1; m <= maxMes; m++) meses.push(m);

    let recalculados = 0;
    const errores: Array<{
      indicador_id: string;
      indicador_nombre: string;
      mes: number;
      error: string;
    }> = [];
    const total = indicadores.length * meses.length;

    for (const indicador of indicadores) {
      for (const mes of meses) {
        try {
          const latest = await IndicadorVersion.findOne({
            where: { indicador_id: indicador.id },
            order: [["version", "DESC"]],
          });

          if (!latest) {
            errores.push({
              indicador_id: indicador.id,
              indicador_nombre: indicador.nombre,
              mes,
              error: "Sin versiones definidas",
            });
            continue;
          }

          const definicion = parseDefinicionIndicador(latest.definicion);

          let conceptMap: Record<string, number> | null = null;
          const ordenes = definicion.evento?.ordenes;
          if (ordenes && ordenes.length > 0) {
            const uuids = ordenes.map((f) => f.concepto_uuid);
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
          }

          const { inicio, fin, mes_referencia } = calcularMesEspecifico(anio, mes);
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
          );

          recalculados += 1;
        } catch (err: unknown) {
          const message =
            err instanceof Error ? err.message : "Error desconocido";
          errores.push({
            indicador_id: indicador.id,
            indicador_nombre: indicador.nombre,
            mes,
            error: message,
          });
        }
      }
    }

    res.json({
      anio,
      indicador_id: indicador_id || null,
      meses_procesados: meses.length,
      indicadores_considerados: indicadores.length,
      recalculados,
      errores,
      total,
    });
  }),
);
