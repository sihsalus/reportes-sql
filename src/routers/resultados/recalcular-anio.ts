/**
 * POST /resultados/recalcular-anio handler — annual recalculation.
 *
 * Iterates over all months (1..maxMes) for a given year, recalculating
 * every active indicator (or a single one when indicador_id is provided).
 *
 * Strategy: batch version lookup (DISTINCT ON), batch concept resolution,
 * then per-indicator × per-month execution with error isolation.
 */
import type { Request, Response } from "express";
import { QueryTypes } from "sequelize";
import { Indicador, IndicadorVersion } from "../../models/indicador.js";
import { sequelize } from "../../database/postgres.js";
import { parseDefinicionIndicador } from "../../types/definicion.js";
import { buildQuery } from "../../engine/interpreter.js";
import { executeAndPersist } from "../../engine/executor.js";
import { calcularMesEspecifico } from "../../engine/periodo.js";
import { resolveConceptMap } from "../../validators/openmrs.js";
import { rateLimit } from "./rate-limit.js";

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
}
