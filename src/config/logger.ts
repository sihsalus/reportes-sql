/**
 * Thin structured-logging wrapper over console.
 *
 * - Adds log levels (debug, info, warn, error) controlled by LOG_LEVEL.
 * - In production, serialises metadata as JSON; in dev, human-friendly.
 * - Child loggers carry bound context (e.g. requestId).
 */

const isProduction = process.env["NODE_ENV"] === "production";

type Level = "debug" | "info" | "warn" | "error";
const LEVELS: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const currentLevel: Level =
  (process.env["LOG_LEVEL"] as Level | undefined) ??
  (isProduction ? "info" : "debug");

function shouldLog(level: Level): boolean {
  return LEVELS[level] >= LEVELS[currentLevel];
}

/**
 * Time zone for log timestamps, fixed in code so logs always show the
 * deployment's wall clock (Peru, UTC-5, no DST) regardless of the host or
 * container TZ.
 */
const LOG_TIME_ZONE = "America/Lima";

/**
 * ISO-8601 timestamp in {@link LOG_TIME_ZONE} with an explicit offset
 * (e.g. `2026-10-09T09:23:45.123-05:00`). Replaces the previous UTC-only
 * `toISOString()` so log times match the local wall clock.
 */
function localIsoString(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: LOG_TIME_ZONE,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const part = (type: string): string =>
    parts.find((p) => p.type === type)?.value ?? "";

  const offsetName =
    new Intl.DateTimeFormat("en-US", {
      timeZone: LOG_TIME_ZONE,
      timeZoneName: "longOffset",
    })
      .formatToParts(date)
      .find((p) => p.type === "timeZoneName")?.value ?? "GMT";
  const offset = offsetName.replace("GMT", "") || "+00:00";

  const ms = String(date.getMilliseconds()).padStart(3, "0");
  return (
    `${part("year")}-${part("month")}-${part("day")}` +
    `T${part("hour")}:${part("minute")}:${part("second")}.${ms}${offset}`
  );
}

function fmt(level: Level, msg: string, meta?: unknown): string {
  const ts = localIsoString(new Date());
  if (meta !== undefined) {
    return isProduction
      ? JSON.stringify({ ts, level, msg, ...(meta as object) })
      : `${ts} [${level.toUpperCase()}] ${msg} ${JSON.stringify(meta)}`;
  }
  return isProduction
    ? JSON.stringify({ ts, level, msg })
    : `${ts} [${level.toUpperCase()}] ${msg}`;
}

export interface Logger {
  debug(msg: string, meta?: unknown): void;
  info(msg: string, meta?: unknown): void;
  warn(msg: string, meta?: unknown): void;
  error(msg: string, meta?: unknown): void;
  child(bindings: Record<string, unknown>): Logger;
}

function createLogger(bindings?: Record<string, unknown>): Logger {
  function log(level: Level, msg: string, meta?: unknown): void {
    if (!shouldLog(level)) return;
    const merged = bindings ? { ...bindings, ...(meta as object ?? {}) } : meta;
    const line = fmt(level, msg, merged && Object.keys(merged as object).length > 0 ? merged : undefined);
    switch (level) {
      case "error": console.error(line); break;
      case "warn":  console.warn(line);  break;
      case "info":  console.info(line);  break;
      default:      console.debug(line); break;
    }
  }

  return {
    debug: (msg, meta) => log("debug", msg, meta),
    info:  (msg, meta) => log("info",  msg, meta),
    warn:  (msg, meta) => log("warn",  msg, meta),
    error: (msg, meta) => log("error", msg, meta),
    child: (b) => createLogger({ ...bindings, ...b }),
  };
}

export const logger: Logger = createLogger();

/** Shortcut for request-scoped child logger. */
export function requestLogger(requestId: string): Logger {
  return logger.child({ requestId });
}
