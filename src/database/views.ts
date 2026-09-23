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

const CANONICAL_BACKFILL_KEY = "canonical_backfill_v1";

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
  // Hard guard: at most one canonical row per version + month. The executor
  // supersedes-then-inserts per recalculation, but without this constraint a
  // missed supersede (or two concurrent recalcs) left several canonical rows
  // and every series SUM silently multiplied the value.
  await sequelize.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_resultado_version_mes_canonico
     ON indicador_resultado (indicador_version_id, mes_referencia)
     WHERE es_canonico = true`,
    { type: QueryTypes.RAW },
  );
}

/**
 * Repair rows left duplicated before the unique guard existed.
 *
 * Keeps exactly one canonical row per (indicador_version_id, mes_referencia):
 * the latest by calculado_en (deterministic tie-break on id). Runs before
 * {@link ensureCanonicalResultIndex} so the UNIQUE index creation never fails
 * on legacy duplicates. Idempotent — a clean table matches 0 rows.
 */
export async function deduplicateCanonicalResults(): Promise<void> {
  await sequelize.query(
    `UPDATE indicador_resultado ir
     SET es_canonico = false
     WHERE ir.es_canonico = true
       AND ir.mes_referencia IS NOT NULL
       AND EXISTS (
         SELECT 1 FROM indicador_resultado newer
         WHERE newer.indicador_version_id = ir.indicador_version_id
           AND newer.mes_referencia = ir.mes_referencia
           AND newer.es_canonico = true
           AND (newer.calculado_en > ir.calculado_en
             OR (newer.calculado_en = ir.calculado_en AND newer.id > ir.id))
       )`,
    { type: QueryTypes.UPDATE },
  );
  logger.info("Canonical duplicates deduplicated (kept latest per version+month).");
}

/**
 * Backfill `mes_referencia` and `es_canonico` for existing rows.
 *
 * - Sets `mes_referencia` from the first day of `periodo_inicio` when null.
 * - Marks existing rows as canonical when `es_canonico` is false and no
 *   canonical row already exists for the same version + month.
 *
 * Runs at most once: a marker row in `app_metadata` (canonical_backfill_v1)
 * records that the full-table UPDATEs were already applied, so subsequent
 * boots skip them. The marker write is best-effort — if it fails, the
 * UPDATEs will re-run on the next boot, which is safe (idempotent).
 */
export async function backfillResultadoCanonical(): Promise<void> {
  const applied = await AppMetadata.findOne({
    where: { key: CANONICAL_BACKFILL_KEY },
  });
  if (applied) {
    logger.info("Backfill ya aplicado, skipping");
    return;
  }

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

  try {
    await AppMetadata.create({
      key: CANONICAL_BACKFILL_KEY,
      value: "done",
    });
  } catch (err) {
    logger.warn(
      "No se pudo registrar el backfill como aplicado; se re-ejecutará en el próximo arranque",
      { error: err instanceof Error ? err.message : String(err) },
    );
  }

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
