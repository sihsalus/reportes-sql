/**
 * Indicador CRUD router — Express endpoints for indicator lifecycle.
 *
 * - POST   /indicadores                   → create Indicador + version 1
 * - GET    /indicadores                   → list active indicators (paginated)
 * - GET    /indicadores/:id               → detail with all versions
 * - PUT    /indicadores/:id               → update metadata (auto-versioning)
 * - DELETE /indicadores/:id               → soft-delete (activo=false)
 * - POST   /indicadores/:id/versiones     → create new immutable version
 * - GET    /indicadores/:id/preview-sql   → SQL preview for a version
 */

import { Router, type Request, type Response } from "express";
import { v4 as uuidv4 } from "uuid";
import {
  Indicador,
  IndicadorVersion,
  IndicadorResultado,
} from "../models/indicador.js";
import {
  parseDefinicionIndicador,
  DefinicionIndicadorSchema,
  type DefinicionIndicador,
} from "../types/definicion.js";
import { buildQuery } from "../engine/interpreter.js";
import { calcularPeriodo } from "../engine/periodo.js";
import {
  validarDefinicionLocationUuids,
  resolveConceptMap,
} from "../validators/openmrs.js";

export const indicadoresRouter = Router();

// ── Helper: async handler wrapper ──────────────────────────────────────

function asyncHandler(
  fn: (req: Request, res: Response) => Promise<void>,
) {
  return (req: Request, res: Response) => {
    fn(req, res).catch((err: unknown) => {
      console.error("Unhandled error in indicadores router:", err);
      res.status(500).json({
        detail: "Error interno del servidor",
      });
    });
  };
}

// ── POST /indicadores ──────────────────────────────────────────────────

indicadoresRouter.post(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    const body = req.body as {
      nombre?: string;
      descripcion?: string | null;
      definicion?: unknown;
    };

    if (!body.nombre || typeof body.nombre !== "string" || body.nombre.trim().length === 0) {
      res.status(422).json({
        detail: {
          field: "nombre",
          message: "nombre es obligatorio y no puede estar vacío",
        },
      });
      return;
    }
    if (!body.definicion) {
      res.status(422).json({
        detail: {
          field: "definicion",
          message: "definicion es obligatorio",
        },
      });
      return;
    }

    // Parse and validate definicion
    let definicion: DefinicionIndicador;
    try {
      definicion = parseDefinicionIndicador(body.definicion);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Validation error";
      res.status(422).json({
        detail: { field: "definicion", message },
      });
      return;
    }

    // Validate location_uuids exist in OpenMRS before DB write.
    try {
      const unknownUuids = await validarDefinicionLocationUuids(definicion);
      if (unknownUuids.length > 0) {
        res.status(422).json({
          detail: {
            field: "location_uuids",
            unknown_uuids: unknownUuids,
          },
        });
        return;
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "OpenMRS no disponible";
      res.status(502).json({ detail: message });
      return;
    }

    const indicadorId = uuidv4();
    const now = new Date();

    await Indicador.create({
      id: indicadorId,
      nombre: body.nombre.trim(),
      descripcion: body.descripcion ?? null,
      activo: true,
      creado_en: now,
    });

    await IndicadorVersion.create({
      id: uuidv4(),
      indicador_id: indicadorId,
      version: 1,
      definicion: definicion as unknown as Record<string, unknown>,
      creado_en: now,
    });

    const created = await Indicador.findByPk(indicadorId);
    res.status(201).json(created?.toJSON());
  }),
);

// ── GET /indicadores ───────────────────────────────────────────────────

indicadoresRouter.get(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    const page = Math.max(1, parseInt((req.query["page"] as string) ?? "1", 10) || 1);
    const size = Math.min(100, Math.max(1, parseInt((req.query["size"] as string) ?? "20", 10) || 20));

    const { count, rows } = await Indicador.findAndCountAll({
      where: { activo: true },
      order: [["creado_en", "DESC"]],
      offset: (page - 1) * size,
      limit: size,
    });

    const pages = Math.max(1, Math.ceil(count / size));

    res.json({
      items: rows,
      total: count,
      page,
      size,
      pages,
    });
  }),
);

// ── GET /indicadores/:id ───────────────────────────────────────────────

indicadoresRouter.get(
  "/:id",
  asyncHandler(async (req: Request, res: Response) => {
    const id = req.params["id"] as string;
    const indicador = await Indicador.findByPk(id);
    if (!indicador) {
      res.status(404).json({ detail: "Indicador no encontrado" });
      return;
    }

    const versiones = await IndicadorVersion.findAll({
      where: { indicador_id: indicador.id },
      order: [["version", "DESC"]],
    });

    res.json({
      ...indicador.toJSON(),
      versiones,
    });
  }),
);

// ── PUT /indicadores/:id ───────────────────────────────────────────────

indicadoresRouter.put(
  "/:id",
  asyncHandler(async (req: Request, res: Response) => {
    const id = req.params["id"] as string;
    const indicador = await Indicador.findByPk(id);
    if (!indicador) {
      res.status(404).json({ detail: "Indicador no encontrado" });
      return;
    }

    const body = req.body as {
      nombre?: string;
      descripcion?: string | null;
      definicion?: unknown;
    };

    if (!body.nombre || typeof body.nombre !== "string" || body.nombre.trim().length === 0) {
      res.status(422).json({
        detail: {
          field: "nombre",
          message: "nombre es obligatorio",
        },
      });
      return;
    }

    // ── Auto-versioning when definicion is present ──
    if (body.definicion != null) {
      let newDefinicion: DefinicionIndicador;
      try {
        newDefinicion = parseDefinicionIndicador(body.definicion);
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : "Validation error";
        res.status(422).json({
          detail: { field: "definicion", message },
        });
        return;
      }

      // Fetch latest version for comparison
      const latestVersion = await IndicadorVersion.findOne({
        where: { indicador_id: indicador.id },
        order: [["version", "DESC"]],
      });

      // Normalize both for order-insensitive comparison
      const incoming = JSON.stringify(
        newDefinicion,
        Object.keys(newDefinicion as Record<string, unknown>).sort(),
      );

      let existing: string | null = null;
      if (latestVersion) {
        try {
          const parsed = parseDefinicionIndicador(latestVersion.definicion);
          existing = JSON.stringify(
            parsed,
            Object.keys(parsed as Record<string, unknown>).sort(),
          );
        } catch {
          existing = null;
        }
      }

      if (incoming !== existing) {
        // Validate location UUIDs against OpenMRS
        try {
          const unknownUuids = await validarDefinicionLocationUuids(newDefinicion);
          if (unknownUuids.length > 0) {
            res.status(422).json({
              detail: {
                field: "location_uuids",
                unknown_uuids: unknownUuids,
              },
            });
            return;
          }
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : "OpenMRS no disponible";
          res.status(502).json({ detail: message });
          return;
        }

        // Compute next version number
        const maxVersion: number | null = await IndicadorVersion.max("version", {
          where: { indicador_id: indicador.id },
        });

        const nextVersion = (maxVersion ?? 0) + 1;

        await IndicadorVersion.create({
          id: uuidv4(),
          indicador_id: indicador.id,
          version: nextVersion,
          definicion: newDefinicion as unknown as Record<string, unknown>,
          creado_en: new Date(),
        });
      }
    }

    // Always update metadata
    await indicador.update({
      nombre: body.nombre.trim(),
      descripcion: body.descripcion ?? null,
    });

    res.json(indicador.toJSON());
  }),
);

// ── DELETE /indicadores/:id ────────────────────────────────────────────

indicadoresRouter.delete(
  "/:id",
  asyncHandler(async (req: Request, res: Response) => {
    const id = req.params["id"] as string;
    const indicador = await Indicador.findByPk(id);
    if (!indicador) {
      res.status(404).json({ detail: "Indicador no encontrado" });
      return;
    }

    await indicador.update({ activo: false });
    res.status(204).send();
  }),
);

// ── POST /indicadores/:id/versiones ────────────────────────────────────

indicadoresRouter.post(
  "/:id/versiones",
  asyncHandler(async (req: Request, res: Response) => {
    const id = req.params["id"] as string;
    const indicador = await Indicador.findByPk(id);
    if (!indicador) {
      res.status(404).json({ detail: "Indicador no encontrado" });
      return;
    }

    const body = req.body as { definicion?: unknown };
    if (!body.definicion) {
      res.status(422).json({
        detail: {
          field: "definicion",
          message: "definicion es obligatorio",
        },
      });
      return;
    }

    let definicion: DefinicionIndicador;
    try {
      definicion = parseDefinicionIndicador(body.definicion);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Validation error";
      res.status(422).json({
        detail: { field: "definicion", message },
      });
      return;
    }

    // Validate location_uuids against OpenMRS
    try {
      const unknownUuids = await validarDefinicionLocationUuids(definicion);
      if (unknownUuids.length > 0) {
        res.status(422).json({
          detail: {
            field: "location_uuids",
            unknown_uuids: unknownUuids,
          },
        });
        return;
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "OpenMRS no disponible";
      res.status(502).json({ detail: message });
      return;
    }

    const maxVersion: number | null = await IndicadorVersion.max("version", {
      where: { indicador_id: indicador.id },
    });
    const nextVersion = (maxVersion ?? 0) + 1;

    try {
      const nuevaVersion = await IndicadorVersion.create({
        id: uuidv4(),
        indicador_id: indicador.id,
        version: nextVersion,
        definicion: definicion as unknown as Record<string, unknown>,
        creado_en: new Date(),
      });

      res.status(201).json(nuevaVersion.toJSON());
    } catch (err: unknown) {
      // UNIQUE constraint violation → 409 Conflict
      const message = err instanceof Error ? err.message : "";
      if (
        message.includes("duplicate") ||
        message.includes("unique") ||
        message.includes("violates")
      ) {
        res.status(409).json({
          detail:
            "Conflicto de versión — otro proceso creó la misma versión. Intente nuevamente.",
        });
        return;
      }
      throw err;
    }
  }),
);

// ── GET /indicadores/:id/preview-sql ───────────────────────────────────

indicadoresRouter.get(
  "/:id/preview-sql",
  asyncHandler(async (req: Request, res: Response) => {
    const id = req.params["id"] as string;
    const indicador = await Indicador.findByPk(id);
    if (!indicador) {
      res.status(404).json({ detail: "Indicador no encontrado" });
      return;
    }

    // Fetch version (specific or latest)
    const versionId = req.query["version_id"] as string | undefined;

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

    // Parse definicion and compute period
    const definicion = parseDefinicionIndicador(version.definicion);
    const [periodoInicio, periodoFin] = calcularPeriodo(definicion.periodo);

    // Resolve concept_map for ordenes from OpenMRS MySQL
    let conceptMap: Record<string, number> | null = null;
    const ordenes = definicion.evento?.ordenes;
    if (ordenes && ordenes.length > 0) {
      const uuids = ordenes.map((f) => f.concepto_uuid);
      try {
        const resolved = await resolveConceptMap(uuids);
        conceptMap = {};
        for (const f of ordenes) {
          const cid = resolved[f.concepto_uuid];
          if (cid !== undefined) {
            conceptMap[f.concepto_uuid] = cid;
          }
        }
      } catch {
        // Concept resolution failed — proceed without it (ordenes filter omitted)
        conceptMap = null;
      }
    }

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
  }),
);
