/**
 * Period calculation helper — shared between routers.
 *
 * Extracted so the SQL preview endpoint can reuse the same period
 * calculation logic without circular imports.
 */

/**
 * Calculate the current calendar month's boundaries in UTC.
 *
 * Returns [inicio, fin] where:
 * - inicio: first day of the current month at 00:00 UTC
 * - fin: today at 00:00 UTC (for real-time calculation) or last day of month
 *
 * Use `mes_referencia` (inicio) as the canonical month identifier
 * when persisting results.
 */
export function calcularMesActual(): { inicio: Date; fin: Date; mes_referencia: Date } {
  const hoy = todayUTC();
  const inicio = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), 1));
  return { inicio, fin: hoy, mes_referencia: inicio };
}

/**
 * Calculate the boundaries for a specific month given its first day.
 * Used when recalculating historical months.
 */
export function calcularMesEspecifico(
  anio: number,
  mes: number, // 1-indexed (January = 1)
): { inicio: Date; fin: Date; mes_referencia: Date } {
  const inicio = new Date(Date.UTC(anio, mes - 1, 1));
  const fin = new Date(Date.UTC(anio, mes, 0)); // last day of month
  return { inicio, fin, mes_referencia: inicio };
}

/**
 * Return today's date in UTC, with time set to 00:00:00.
 */
function todayUTC(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}
