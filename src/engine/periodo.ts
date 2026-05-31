/**
 * Period calculation helper — shared between routers.
 *
 * Extracted so the SQL preview endpoint can reuse the same period
 * calculation logic without circular imports.
 */

import type { PeriodoIndicador } from "../types/definicion.js";

/**
 * Translate a periodo literal into a concrete (inicio, fin) date pair.
 *
 * Uses JavaScript Date for month/year boundaries and day arithmetic.
 *
 * @throws Error for unknown periodo literals.
 */
export function calcularPeriodo(periodo: PeriodoIndicador): [Date, Date] {
  const hoy = todayUTC();

  switch (periodo) {
    case "mes_actual": {
      const inicio = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), 1));
      return [inicio, hoy];
    }

    case "trimestre_actual": {
      const month = hoy.getUTCMonth();
      const trimestre = Math.floor(month / 3);
      const inicioMes = trimestre * 3;
      const inicio = new Date(Date.UTC(hoy.getUTCFullYear(), inicioMes, 1));
      return [inicio, hoy];
    }

    case "semestre_actual": {
      const inicioMes = hoy.getUTCMonth() <= 5 ? 0 : 6;
      const inicio = new Date(Date.UTC(hoy.getUTCFullYear(), inicioMes, 1));
      return [inicio, hoy];
    }

    case "anual_actual": {
      const inicio = new Date(Date.UTC(hoy.getUTCFullYear(), 0, 1));
      return [inicio, hoy];
    }

    default:
      throw new Error(`Periodo desconocido: ${periodo}`);
  }
}

/**
 * Return today's date in UTC, with time set to 00:00:00.
 */
function todayUTC(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}
