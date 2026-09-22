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
import { AppMetadata } from "../models/indicador.js";
import { logger } from "../config/logger.js";

const CANONICAL_BACKFILL_KEY = "canonical_backfill_v2";

/**
 * Ensure the partial index used by cross-version canonical supersede exists.
 *
 * The model declaration covers fresh tables, but `sequelize.sync()` does not
 * add indexes to an existing table. Keep this idempotent guard until schema
 * migrations replace startup schema maintenance.
 */
export async function ensureCanonicalResultIndex(): Promise<void> {
  await sequelize.query(
    `CREATE INDEX IF NOT EXISTS idx_resultado_canonico_mes
     ON indicador_resultado (mes_referencia)
     WHERE es_canonico = true`,
    { type: QueryTypes.RAW },
  );
}

/**
 * Preserve all result rows while selecting one canonical result per indicator
 * and month. Explicit historical rows with a known month stay historical.
 * Legacy rows (no month) can become canonical only when no current row wins.
 * The table lock serializes startup with writers; the marker and data commit
 * together, so a failure cannot leave a partially applied migration.
 */
export async function backfillResultadoCanonical(): Promise<void> {
  await sequelize.transaction(async (transaction) => {
    await sequelize.query(
      "LOCK TABLE indicador_resultado IN SHARE ROW EXCLUSIVE MODE",
      { transaction, type: QueryTypes.RAW },
    );
    const applied = await AppMetadata.findOne({
      where: { key: CANONICAL_BACKFILL_KEY },
      transaction,
    });
    if (applied) return;

    await sequelize.query(
      `WITH candidates AS (
         SELECT ir.id,
                ROW_NUMBER() OVER (
                  PARTITION BY iv.indicador_id,
                    COALESCE(ir.mes_referencia, DATE_TRUNC('month', ir.periodo_inicio)::DATE)
                  ORDER BY ir.es_canonico DESC, ir.calculado_en DESC, iv.version DESC, ir.id DESC
                ) AS position
         FROM indicador_resultado ir
         JOIN indicador_version iv ON iv.id = ir.indicador_version_id
         WHERE ir.es_canonico = true OR ir.mes_referencia IS NULL
       )
       UPDATE indicador_resultado ir
       SET mes_referencia = COALESCE(ir.mes_referencia, DATE_TRUNC('month', ir.periodo_inicio)::DATE),
           es_canonico = candidates.position = 1
       FROM candidates
       WHERE candidates.id = ir.id`,
      { transaction, type: QueryTypes.UPDATE },
    );
    await AppMetadata.create(
      { key: CANONICAL_BACKFILL_KEY, value: "done" },
      { transaction },
    );
  });
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
