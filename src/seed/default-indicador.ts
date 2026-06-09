import { Indicador, IndicadorVersion } from "../models/indicador.js";
import { parseDefinicionIndicador } from "../types/definicion.js";

const SEEDED_INDICADOR_NOMBRE = "seed/default-indicator";

const DEFAULT_DEFINICION = parseDefinicionIndicador({
  tipo: "conteo_atenciones",
});

export interface SeedDefaultIndicadorResult {
  indicatorCreated: boolean;
  versionCreated: boolean;
  indicadorId: string;
}

export async function seedDefaultIndicador(): Promise<SeedDefaultIndicadorResult> {
  const now = new Date();

  let indicador = await Indicador.findOne({
    where: { nombre: SEEDED_INDICADOR_NOMBRE },
  });

  let indicatorCreated = false;
  if (!indicador) {
    indicador = await Indicador.create({
      nombre: SEEDED_INDICADOR_NOMBRE,
      descripcion: "Auto-seeded default indicator for bootstrap/testing.",
      activo: true,
      creado_en: now,
    });
    indicatorCreated = true;
  }

  const existingVersion = await IndicadorVersion.findOne({
    where: {
      indicador_id: indicador.id,
      version: 1,
    },
  });

  let versionCreated = false;
  if (!existingVersion) {
    await IndicadorVersion.create({
      indicador_id: indicador.id,
      version: 1,
      definicion: DEFAULT_DEFINICION as Record<string, unknown>,
      creado_en: now,
    });
    versionCreated = true;
  }

  return {
    indicatorCreated,
    versionCreated,
    indicadorId: indicador.id,
  };
}

export { SEEDED_INDICADOR_NOMBRE, DEFAULT_DEFINICION };
