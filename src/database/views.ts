/**
 * PostgreSQL views for time-series rollups.
 *
 * These views derive additive quarterly, semiannual, and annual rollups from
 * canonical monthly result rows. Direct SQL consumers (e.g. Grafana) and the
 * `/resultados/series` API share the same aggregation semantics.
 *
 * Views are created on application startup. They are read-only and safe to
 * run repeatedly (CREATE OR REPLACE).
 */

import { sequelize } from "./postgres.js";
import { QueryTypes } from "sequelize";
import { logger } from "../config/logger.js";

/**
 * Backfill `mes_referencia` and `es_canonico` for existing rows.
 *
 * - Sets `mes_referencia` from the first day of `periodo_inicio` when null.
 * - Marks existing rows as canonical when `es_canonico` is false and no
 *   canonical row already exists for the same version + month.
 */
export async function backfillResultadoCanonical(): Promise<void> {
  await sequelize.query(
    `UPDATE indicador_resultado
     SET mes_referencia = DATE_TRUNC('month', periodo_inicio)::DATE
     WHERE mes_referencia IS NULL`,
    { type: QueryTypes.UPDATE },
  );

  // Mark existing rows as canonical where no canonical row exists yet
  await sequelize.query(
    `UPDATE indicador_resultado ir
     SET es_canonico = true
     WHERE ir.es_canonico = false
       AND ir.mes_referencia IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM indicador_resultado ir2
         WHERE ir2.indicador_version_id = ir.indicador_version_id
           AND ir2.mes_referencia = ir.mes_referencia
           AND ir2.es_canonico = true
       )`,
    { type: QueryTypes.UPDATE },
  );

  logger.info("Backfill: mes_referencia and es_canonico populated.");
}

const ROLLUP_VIEWS = {
  vw_resultado_mensual: `
    CREATE OR REPLACE VIEW vw_resultado_mensual AS
    SELECT
      iv.indicador_id,
      iv.id AS version_id,
      iv.version,
      ir.id AS resultado_id,
      ir.mes_referencia,
      ir.valor,
      ir.calculado_en,
      i.nombre AS indicador_nombre
    FROM indicador_resultado ir
    JOIN indicador_version iv ON iv.id = ir.indicador_version_id
    JOIN indicador i ON i.id = iv.indicador_id
    WHERE ir.es_canonico = true
      AND ir.mes_referencia IS NOT NULL
    ORDER BY iv.indicador_id, ir.mes_referencia
  `,

  vw_resultado_trimestral: `
    CREATE OR REPLACE VIEW vw_resultado_trimestral AS
    SELECT
      iv.indicador_id,
      iv.id AS version_id,
      iv.version,
      EXTRACT(YEAR FROM ir.mes_referencia)::int AS anio,
      EXTRACT(QUARTER FROM ir.mes_referencia)::int AS trimestre,
      'Q' || EXTRACT(QUARTER FROM ir.mes_referencia)::int AS periodo_label,
      SUM(ir.valor)::numeric AS valor,
      COUNT(*)::int AS meses_disponibles,
      i.nombre AS indicador_nombre
    FROM indicador_resultado ir
    JOIN indicador_version iv ON iv.id = ir.indicador_version_id
    JOIN indicador i ON i.id = iv.indicador_id
    WHERE ir.es_canonico = true
      AND ir.mes_referencia IS NOT NULL
    GROUP BY
      iv.indicador_id,
      i.nombre,
      iv.id,
      iv.version,
      EXTRACT(YEAR FROM ir.mes_referencia),
      EXTRACT(QUARTER FROM ir.mes_referencia)
    ORDER BY iv.indicador_id, anio, trimestre
  `,

  vw_resultado_semestral: `
    CREATE OR REPLACE VIEW vw_resultado_semestral AS
    SELECT
      iv.indicador_id,
      iv.id AS version_id,
      iv.version,
      EXTRACT(YEAR FROM ir.mes_referencia)::int AS anio,
      CASE WHEN EXTRACT(MONTH FROM ir.mes_referencia) <= 6 THEN 1 ELSE 2 END AS semestre,
      'H' || CASE WHEN EXTRACT(MONTH FROM ir.mes_referencia) <= 6 THEN 1 ELSE 2 END AS periodo_label,
      SUM(ir.valor)::numeric AS valor,
      COUNT(*)::int AS meses_disponibles,
      i.nombre AS indicador_nombre
    FROM indicador_resultado ir
    JOIN indicador_version iv ON iv.id = ir.indicador_version_id
    JOIN indicador i ON i.id = iv.indicador_id
    WHERE ir.es_canonico = true
      AND ir.mes_referencia IS NOT NULL
    GROUP BY
      iv.indicador_id,
      i.nombre,
      iv.id,
      iv.version,
      EXTRACT(YEAR FROM ir.mes_referencia),
      CASE WHEN EXTRACT(MONTH FROM ir.mes_referencia) <= 6 THEN 1 ELSE 2 END
    ORDER BY iv.indicador_id, anio, semestre
  `,

  vw_resultado_anual: `
    CREATE OR REPLACE VIEW vw_resultado_anual AS
    SELECT
      iv.indicador_id,
      iv.id AS version_id,
      iv.version,
      EXTRACT(YEAR FROM ir.mes_referencia)::int AS anio,
      TO_CHAR(MIN(ir.mes_referencia), 'YYYY') AS periodo_label,
      SUM(ir.valor)::numeric AS valor,
      COUNT(*)::int AS meses_disponibles,
      i.nombre AS indicador_nombre
    FROM indicador_resultado ir
    JOIN indicador_version iv ON iv.id = ir.indicador_version_id
    JOIN indicador i ON i.id = iv.indicador_id
    WHERE ir.es_canonico = true
      AND ir.mes_referencia IS NOT NULL
    GROUP BY
      iv.indicador_id,
      i.nombre,
      iv.id,
      iv.version,
      EXTRACT(YEAR FROM ir.mes_referencia)
    ORDER BY iv.indicador_id, anio
  `,
};

/**
 * Create or replace all rollup views. Safe to call repeatedly.
 */
export async function createRollupViews(): Promise<void> {
  for (const [viewName, sql] of Object.entries(ROLLUP_VIEWS)) {
    await sequelize.query(sql, { type: QueryTypes.RAW });
    logger.info("View created/refreshed", { viewName });
  }
}
