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
export function calcularMesActual(): {
  inicio: Date;
  fin: Date;
  finPersistencia: Date;
  mes_referencia: Date;
} {
  const hoy = todayUTC();
  const inicio = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), 1));
  const finPersistencia = new Date(
    Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth() + 1, 0),
  );
  return { inicio, fin: hoy, finPersistencia, mes_referencia: inicio };
}

/**
 * Calculate the boundaries for a specific month given its first day.
 * Used when recalculating historical months.
 *
 * @throws RangeError when `anio` is not an integer or `mes` is outside 1-12.
 *   `Date.UTC` would otherwise normalize out-of-range values silently
 *   (month 13 becomes January of the next year, month 0 December of the
 *   previous one), producing results attributed to the wrong month.
 */
export function calcularMesEspecifico(
  anio: number,
  mes: number, // 1-indexed (January = 1)
): { inicio: Date; fin: Date; mes_referencia: Date } {
  if (!Number.isInteger(anio)) {
    throw new RangeError(`anio debe ser un entero: ${String(anio)}`);
  }
  if (!Number.isInteger(mes) || mes < 1 || mes > 12) {
    throw new RangeError(`mes debe estar entre 1 y 12: ${String(mes)}`);
  }
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
