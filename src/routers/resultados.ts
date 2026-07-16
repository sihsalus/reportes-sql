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
import { resolveOrcenesConceptMap } from "../engine/concept-resolver.js";

import { asyncHandler } from "../middleware/async-handler.js";

export const resultadosRouter: Router = Router();

// ── Rate limiter for expensive batch endpoints ─────────────────────────

const rateLimitStore = new Map<string, { count: number; resetAt: number }>();

function rateLimit(
  key: string,
  maxRequests: number,
  windowMs: number,
): boolean {
  const now = Date.now();
  const entry = rateLimitStore.get(key);

  if (!entry || now > entry.resetAt) {
    rateLimitStore.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }

  if (entry.count >= maxRequests) {
    return false;
  }

  entry.count++;
  return true;
}

// Cleanup stale entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitStore) {
    if (now > entry.resetAt) {
      rateLimitStore.delete(key);
    }
  }
}, 5 * 60 * 1000);

// Exported for testing only
export function resetRateLimitStore(): void {
  rateLimitStore.clear();
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
      TO_CHAR(MIN(mes_referencia), 'YYYY') AS periodo_label,
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
    const includeMeta = req.query["include_meta"] === "true";

    if (!indicadorId) {
      res.status(422).json({
        detail: { field: "indicador_id", message: "indicador_id es obligatorio" },
      });
      return;
    }

    // Strict integer contract: reject missing, non-digit, or non-integer
    // values before parsing. `parseInt("2026abc", 10) === 2026`, so we must
    // validate the raw string with a digit-only pattern.
    if (anioStr === undefined || anioStr === "") {
      res.status(422).json({
        detail: { field: "anio", message: "anio es obligatorio" },
      });
      return;
    }
    if (!/^-?\d+$/.test(anioStr)) {
      res.status(422).json({
        detail: { field: "anio", message: "anio debe ser un número entero" },
      });
      return;
    }
    const anio = parseInt(anioStr, 10);
    if (anio < 2000 || anio > 2100) {
      res.status(422).json({
        detail: { field: "anio", message: "anio debe estar en el rango 2000-2100" },
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

    // Enrich with meta values when requested
    if (includeMeta && indicadorId) {
      const distinctYears = [...new Set(items.map((r) => r.anio as number))];
      const [latestVersion] = await sequelize.query<{ id: string }>(
        `SELECT iv.id FROM indicador_version iv
         JOIN indicador i ON i.id = iv.indicador_id
         WHERE iv.indicador_id = :iId AND i.activo = true
         ORDER BY iv.version DESC LIMIT 1`,
        { replacements: { iId: indicadorId }, type: QueryTypes.SELECT },
      );
      const metaMap = new Map<number, number | null>();
      if (latestVersion && distinctYears.length > 0) {
        const metaRows = await sequelize.query<{ anio: number; valor_meta: string }>(
          `SELECT anio, valor_meta::float8 FROM indicador_meta
           WHERE indicador_version_id = :vId AND anio = ANY(:years)`,
          { replacements: { vId: latestVersion.id, years: distinctYears }, type: QueryTypes.SELECT },
        );
        for (const m of metaRows) metaMap.set(m.anio, parseFloat(String(m.valor_meta)));
      }
      for (const item of items) {
        item["meta"] = metaMap.get(item.anio as number) ?? null;
      }
    }

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
  asyncHandler(async (req: Request, res: Response) => {
    const clientIp = req.ip ?? req.socket.remoteAddress ?? "unknown";
    if (!rateLimit(`calcular-ahora:${clientIp}`, 3, 60_000)) {
      res.status(429).json({
        detail: "Demasiadas solicitudes. Intentá de nuevo en un minuto.",
      });
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
    const clientIp = req.ip ?? req.socket.remoteAddress ?? "unknown";
    if (!rateLimit(`recalcular-anio:${clientIp}`, 2, 300_000)) {
      res.status(429).json({
        detail: "Demasiadas solicitudes. Intentá de nuevo en 5 minutos.",
      });
      return;
    }

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

    // ── Phase 1: Batch version lookup (single DISTINCT ON query) ──
    const indicadorIds = indicadores.map((i) => i.id);

    interface VersionRow {
      id: string;
      indicador_id: string;
      version: number;
      definicion: Record<string, unknown>;
    }

    const versionRows: VersionRow[] =
      indicadorIds.length > 0
        ? await sequelize.query<VersionRow>(
            `SELECT DISTINCT ON (indicador_id)
               id, indicador_id, version, definicion
             FROM indicador_version
             WHERE indicador_id = ANY(:indicador_ids)
             ORDER BY indicador_id, version DESC`,
            {
              replacements: { indicador_ids: indicadorIds },
              type: QueryTypes.SELECT,
            },
          )
        : [];

    const versionMap = new Map<string, VersionRow>();
    for (const row of versionRows) {
      versionMap.set(row.indicador_id, row);
    }

    // ── Phase 2: Parse definitions + collect all concept UUIDs ──
    const definicionMap = new Map<string, ReturnType<typeof parseDefinicionIndicador>>();
    const allConceptUuids = new Set<string>();
    const indicatorsWithoutVersion: string[] = [];

    for (const indicador of indicadores) {
      const version = versionMap.get(indicador.id);
      if (!version) {
        indicatorsWithoutVersion.push(indicador.id);
        continue;
      }
      const definicion = parseDefinicionIndicador(version.definicion);
      definicionMap.set(indicador.id, definicion);

      const ordenes = definicion.evento?.ordenes;
      if (ordenes && ordenes.length > 0) {
        for (const o of ordenes) {
          allConceptUuids.add(o.concepto_uuid);
        }
      }
    }

    // ── Phase 3: Batch concept resolution (single call) ──
    let globalConceptMap: Record<string, number> = {};
    if (allConceptUuids.size > 0) {
      globalConceptMap = await resolveConceptMap(Array.from(allConceptUuids));
    }

    // ── Phase 4: Per-indicator concept validation ──
    const conceptMapByIndicador = new Map<string, Record<string, number>>();
    const conceptErrorByIndicador = new Map<string, string>();

    for (const indicador of indicadores) {
      if (indicatorsWithoutVersion.includes(indicador.id)) continue;

      const definicion = definicionMap.get(indicador.id)!;
      const ordenes = definicion.evento?.ordenes;
      if (!ordenes || ordenes.length === 0) continue;

      const conceptMap: Record<string, number> = {};
      const missing: string[] = [];
      for (const o of ordenes) {
        const cid = globalConceptMap[o.concepto_uuid];
        if (cid !== undefined) {
          conceptMap[o.concepto_uuid] = cid;
        } else {
          missing.push(o.concepto_uuid);
        }
      }

      if (missing.length > 0) {
        conceptErrorByIndicador.set(
          indicador.id,
          `Conceptos de órdenes no encontrados: ${missing.join(", ")}`,
        );
      } else {
        conceptMapByIndicador.set(indicador.id, conceptMap);
      }
    }

    // ── Phase 5: Per-indicator × per-month execution ──
    let recalculados = 0;
    const errores: Array<{
      indicador_id: string;
      indicador_nombre: string;
      mes: number;
      error: string;
    }> = [];
    const total = indicadores.length * meses.length;

    for (const indicador of indicadores) {
      // No version → error for ALL months
      if (indicatorsWithoutVersion.includes(indicador.id)) {
        for (const mes of meses) {
          errores.push({
            indicador_id: indicador.id,
            indicador_nombre: indicador.nombre,
            mes,
            error: "Sin versiones definidas",
          });
        }
        continue;
      }

      // Concept resolution failure → error for ALL months
      if (conceptErrorByIndicador.has(indicador.id)) {
        const errorMsg = conceptErrorByIndicador.get(indicador.id)!;
        for (const mes of meses) {
          errores.push({
            indicador_id: indicador.id,
            indicador_nombre: indicador.nombre,
            mes,
            error: errorMsg,
          });
        }
        continue;
      }

      const conceptMap =
        conceptMapByIndicador.get(indicador.id) ?? null;
      const definicion = definicionMap.get(indicador.id)!;
      const version = versionMap.get(indicador.id)!;

      for (const mes of meses) {
        try {
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
            version.id,
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
