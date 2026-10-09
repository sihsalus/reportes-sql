/**
 * Parse a positive integer id from a path or query parameter.
 *
 * Domain ids are now DB auto-increment integers, so a non-numeric value must
 * never reach Sequelize/Postgres (an invalid integer string makes the driver
 * throw a 500 instead of matching nothing). Returns null when `raw` is not a
 * positive integer.
 */
export function parseNumericId(raw: unknown): number | null {
  if (typeof raw !== "string" || !/^\d+$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}
