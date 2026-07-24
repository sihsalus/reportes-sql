/**
 * In-memory rate limiter for expensive batch endpoints.
 *
 * Shared by calcular-ahora and recalcular-anio handlers.
 * Uses a simple sliding-window per-key counter with automatic
 * cleanup of stale entries every 5 minutes.
 */

const rateLimitStore = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(
  key: string,
  maxRequests: number,
  windowMs: number,
): boolean {
  const now = Date.now();
  const entry = rateLimitStore.get(key);

  if (!entry || now > entry.resetAt) {
    rateLimitStore.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }

  if (entry.count >= maxRequests) {
    return false;
  }

  entry.count++;
  return true;
}

// Cleanup stale entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitStore) {
    if (now > entry.resetAt) {
      rateLimitStore.delete(key);
    }
  }
}, 5 * 60 * 1000);

/** Exported for testing only. */
export function resetRateLimitStore(): void {
  rateLimitStore.clear();
}
