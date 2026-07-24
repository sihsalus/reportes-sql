/**
 * GET /resultados/series handler — time-series rollups.
 *
 * Returns monthly, quarterly, semestral, or annual aggregations from
 * canonical monthly results. Optionally enriches with annual meta targets.
 */
import type { Request, Response } from "express";
import { QueryTypes } from "sequelize";
import { sequelize } from "../../database/postgres.js";

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
}

// ── SQL templates ──────────────────────────────────────────────────────────

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
}
