/**
 * In-process scheduler for the nightly indicator recalculation.
 *
 * Zero dependencies, same style as the rate-limit timer: a `.unref()`'d
 * interval ticks every few minutes and, once per day at the configured hour
 * (America/Lima), recalculates a rolling window of months (current + previous
 * ones) for every active indicator. On startup it also runs a one-off
 * catch-up of any month of the current year still missing results.
 *
 * It runs inside the service (the calculation endpoints require an OpenMRS
 * session, so an external cron can't call them). Failures are logged and never
 * crash the process.
 */

import { settings } from "../config/index.js";
import { logger } from "../config/logger.js";
import { recalcularProgramado, catchupAnio } from "../engine/batch.js";

/** Fixed deployment time zone for the schedule (Peru, UTC-5, no DST). */
const SCHEDULE_TIME_ZONE = "America/Lima";

/** How often the tick wakes up to check whether the run is due. */
const TICK_INTERVAL_MS = 5 * 60 * 1000;

let timer: NodeJS.Timeout | null = null;
/** `YYYY-MM-DD` (America/Lima) of the last run, to run at most once per day. */
let ultimaCorrida: string | null = null;

interface PartesZona {
  anio: number;
  mes: number;
  dia: number;
  hora: number;
}

/** Calendar parts of `date` in {@link SCHEDULE_TIME_ZONE}. */
function partesEnZona(date: Date): PartesZona {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: SCHEDULE_TIME_ZONE,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
  }).formatToParts(date);
  const get = (type: string): number =>
    Number(parts.find((p) => p.type === type)?.value ?? "0");
  return {
    anio: get("year"),
    mes: get("month"),
    dia: get("day"),
    hora: get("hour"),
  };
}

/**
 * One scheduler tick: run the nightly recalculation when the current hour
 * matches the configured one and today has not run yet.
 *
 * Exported for tests. Never throws — errors are logged.
 */
export async function runRecalcTick(): Promise<void> {
  try {
    const now = new Date();
    const { anio, mes, dia, hora } = partesEnZona(now);

    if (hora !== settings.recalc_hour) return;

    const clave = `${anio}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
    if (ultimaCorrida === clave) return;
    ultimaCorrida = clave;

    logger.info("Iniciando recálculo programado", {
      dia: clave,
      zona: SCHEDULE_TIME_ZONE,
    });
    await recalcularProgramado(now, settings.recalc_window_months);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("Recálculo programado falló", { error: message });
  }
}

/**
 * One-off catch-up at startup: fills months of the current year still missing
 * results. Best-effort — errors are logged.
 */
export async function runStartupCatchup(): Promise<void> {
  try {
    logger.info("Catch-up de recálculo al arrancar");
    await catchupAnio(new Date());
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("Catch-up de recálculo falló", { error: message });
  }
}

/** Start the scheduler. No-op if it is already running. */
export function startRecalcScheduler(): void {
  if (timer !== null) return;

  timer = setInterval(() => {
    void runRecalcTick();
  }, TICK_INTERVAL_MS);
  timer.unref();

  logger.info("Recálculo programado activo", {
    hora: settings.recalc_hour,
    ventanaMeses: settings.recalc_window_months,
    zona: SCHEDULE_TIME_ZONE,
  });
}

/** Stop the scheduler and clear the "already ran today" guard. */
export function stopRecalcScheduler(): void {
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
  ultimaCorrida = null;
}
