/**
 * GET /indicadores/:id/preview-sql — preview generated SQL for an indicator.
 *
 * Accepts optional versionId (camelCase) or version_id (snake_case)
 * query parameter to target a specific version; defaults to latest.
 */
import type { Request, Response } from "express";
import { Indicador, IndicadorVersion } from "../../models/indicador.js";
import { parseDefinicionIndicador } from "../../types/definicion.js";
import { buildQuery } from "../../engine/interpreter.js";
import { calcularMesActual } from "../../engine/periodo.js";
import { resolveOrcenesConceptMapOrNull } from "../../engine/concept-resolver.js";

export async function handlePreviewSql(
  req: Request,
  res: Response,
): Promise<void> {
  const id = req.params["id"] as string;
  const indicador = await Indicador.findByPk(id);
  if (!indicador) {
    res.status(404).json({ detail: "Indicador no encontrado" });
    return;
  }

  // Fetch version (specific or latest)
  // Accept both camelCase (versionId) and snake_case (version_id).
  // If both are present, versionId takes precedence as the canonical JS name.
  const versionId = (req.query["versionId"] ?? req.query["version_id"]) as
    | string
    | undefined;

  let version: IndicadorVersion | null;
  if (versionId) {
    version = await IndicadorVersion.findOne({
      where: {
        id: versionId,
        indicador_id: indicador.id,
      },
    });
    if (!version) {
      res.status(404).json({
        detail: "Versión no encontrada para este indicador",
      });
      return;
    }
  } else {
    version = await IndicadorVersion.findOne({
      where: { indicador_id: indicador.id },
      order: [["version", "DESC"]],
    });
    if (!version) {
      res.status(404).json({
        detail: "El indicador no tiene versiones definidas",
      });
      return;
    }
  }

  // Parse definicion and compute current month period
  const definicion = parseDefinicionIndicador(version.definicion);
  const { inicio: periodoInicio, fin: periodoFin } = calcularMesActual();

  // Resolve concept_map for ordenes from OpenMRS MySQL
  const ordenes = definicion.evento?.ordenes;
  const conceptMap = await resolveOrcenesConceptMapOrNull(ordenes);

  // Build query
  const { sql, params } = buildQuery(
    definicion,
    periodoInicio,
    periodoFin,
    conceptMap,
  );

  // Serialize params for JSON (Date → string)
  const serializableParams: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(params)) {
    if (val instanceof Date) {
      serializableParams[key] = val.toISOString().slice(0, 10);
    } else {
      serializableParams[key] = val;
    }
  }

  res.json({
    sql,
    params: serializableParams,
    periodo_inicio: periodoInicio.toISOString().slice(0, 10),
    periodo_fin: periodoFin.toISOString().slice(0, 10),
    version_id: version.id,
    version_num: version.version,
  });
}
