/**
 * GET /resultados/series handler — time-series rollups.
 *
 * Returns monthly, quarterly, semestral, or annual aggregations from the
 * rollup views over canonical monthly results. Optionally enriches with
 * annual meta targets.
 */
import type { Request, Response } from "express";
import { QueryTypes } from "sequelize";
import { sequelize } from "../../database/postgres.js";
import { findLatestVersion } from "../../indicators/latest-version.js";

// ── Types ──────────────────────────────────────────────────────────────────

type Granularity = "mensual" | "trimestral" | "semestral" | "anual";

interface SeriesRow {
  periodo_label: string;
  valor: number;
  meses_disponibles: number;
  mes_referencia?: string;
  trimestre?: number;
  semestre?: number;
  anio: number;
  version_num?: number;
  version_id?: string;
  versiones?: number[];
}

// ── SQL templates ──────────────────────────────────────────────────────────
//
// These read the rollup views created in src/database/views.ts rather than
// re-deriving the quarterly/semestral/annual aggregation, so the time-series
// math has a single definition shared with direct SQL consumers.
//
// The views split results by version; each template groups that version
// dimension away to keep the per-indicator contract of one row per period,
// with `versiones` listing every contributing version.

const GRANULARITY_SQL: Record<Granularity, string> = {
  mensual: `
    SELECT
      TO_CHAR(mes_referencia, 'YYYY-MM') AS periodo_label,
      mes_referencia,
      EXTRACT(YEAR FROM mes_referencia)::int AS anio,
      1 AS meses_disponibles,
      valor,
      version AS version_num,
      version_id
    FROM vw_resultado_mensual
    WHERE indicador_id = :indicador_id
      AND EXTRACT(YEAR FROM mes_referencia) = :anio
    ORDER BY mes_referencia
  `,
  trimestral: `
    SELECT
      anio,
      trimestre,
      periodo_label,
      SUM(valor)::numeric AS valor,
      SUM(meses_disponibles)::int AS meses_disponibles,
      ARRAY_AGG(DISTINCT version ORDER BY version)::int[] AS versiones
    FROM vw_resultado_trimestral
    WHERE indicador_id = :indicador_id
      AND anio = :anio
    GROUP BY anio, trimestre, periodo_label
    ORDER BY trimestre
  `,
  semestral: `
    SELECT
      anio,
      semestre,
      periodo_label,
      SUM(valor)::numeric AS valor,
      SUM(meses_disponibles)::int AS meses_disponibles,
      ARRAY_AGG(DISTINCT version ORDER BY version)::int[] AS versiones
    FROM vw_resultado_semestral
    WHERE indicador_id = :indicador_id
      AND anio = :anio
    GROUP BY anio, semestre, periodo_label
    ORDER BY semestre
  `,
  anual: `
    SELECT
      anio,
      anio::text AS periodo_label,
      SUM(valor)::numeric AS valor,
      SUM(meses_disponibles)::int AS meses_disponibles,
      ARRAY_AGG(DISTINCT version ORDER BY version)::int[] AS versiones
    FROM vw_resultado_anual
    WHERE indicador_id = :indicador_id
      AND anio = :anio
    GROUP BY anio
    ORDER BY anio
  `,
};

// ── Handler ────────────────────────────────────────────────────────────────

export async function handleSeries(req: Request, res: Response): Promise<void> {
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
    if ("version_num" in r && r.version_num != null) {
      item["version_num"] = Number(r.version_num);
    }
    if ("version_id" in r && r.version_id != null) {
      item["version_id"] = String(r.version_id);
    }
    if ("versiones" in r && r.versiones != null) {
      item["versiones"] = r.versiones;
    }

    return item;
  });

  // Enrich with meta values when requested
  if (includeMeta && indicadorId) {
    const distinctYears = [...new Set(items.map((r) => r.anio as number))];
    const latestVersion = await findLatestVersion(indicadorId, true);
    const metaMap = new Map<number, number | null>();
    if (latestVersion && distinctYears.length > 0) {
      const metaRows = await sequelize.query<{ anio: number; valor_meta: string }>(
        `SELECT anio, valor_meta::float8 FROM indicador_meta
         WHERE indicador_version_id = :vId AND anio IN (:years)`,
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
}
