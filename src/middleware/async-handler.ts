/**
 * Async error-handling wrapper for Express route handlers.
 *
 * Catches rejected promises from async handlers and forwards a 500 response
 * instead of crashing the process. Every router that uses `async (req, res)`
 * handlers should wrap them with this utility to avoid unhandled rejections.
 */

import type { Request, Response, RequestHandler } from "express";
import { logger } from "../config/logger.js";

export function asyncHandler(
  fn: (req: Request, res: Response) => Promise<void>,
): RequestHandler {
  return (req: Request, res: Response) => {
    fn(req, res).catch((err: unknown) => {
      logger.error("Unhandled error in route handler", { err });
      res.status(500).json({
        detail: "Error interno del servidor",
      });
    });
  };
}
