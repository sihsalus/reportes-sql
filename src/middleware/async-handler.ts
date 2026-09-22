/**
 * Async error-handling wrapper for Express route handlers.
 *
 * Forwards rejected promises to Express's error middleware via `next(err)`
 * instead of responding directly. This lets the centralized error middleware
 * in main.ts classify errors (e.g. ZodError → 422, others → 500) consistently
 * for every route, instead of every handler doing its own ad-hoc catch.
 *
 * Handlers that need a specific error shape (e.g. metas.ts mapping ZodError to
 * a field-level 422) still catch locally and respond — they never reach here.
 * Anything that escapes a handler propagates to the central error middleware.
 */
import type { Request, Response, NextFunction, RequestHandler } from "express";

export function asyncHandler(
  fn: (req: Request, res: Response) => Promise<void>,
): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };
}
