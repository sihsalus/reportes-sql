/**
 * Express application entry point for Motor de Indicadores SIH.SALUS.
 *
 * - Creates the Express app with CORS and error middleware.
 * - Includes all three routers: indicadores, resultados, conceptos.
 * - Exposes a /health endpoint for monitoring.
 * - Supports BASE_PATH env var for gateway-friendly path prefixing.
 * - Lifecycle: Sequelize sync on startup, pool disposal on SIGTERM.
 */

import express, {
  type Express,
  type Request,
  type Response,
  type NextFunction,
  Router,
} from "express";
import cors from "cors";
import swaggerUi from "swagger-ui-express";
import { ZodError } from "zod";
import { settings, warnDefaultCredentials } from "./config/index.js";
import { logger, requestLogger } from "./config/logger.js";
import { sequelize } from "./database/postgres.js";
import { disposeMysql } from "./database/mysql.js";
import {
  ensureCanonicalResultIndex,
  deduplicateCanonicalResults,
  backfillResultadoCanonical,
  createRollupViews,
} from "./database/views.js";
import { indicadoresRouter } from "./routers/indicadores.js";
import { resultadosRouter } from "./routers/resultados.js";
import { conceptosRouter } from "./routers/conceptos.js";
import { metasRouter } from "./routers/metas.js";
import { requireSession } from "./middleware/auth.js";
import { buildOpenapiSpec } from "./docs/openapi.js";
import { seedDefaultIndicador } from "./seed/default-indicador.js";

/** Augmented request carrying the request-id used for log correlation. */
type RequestWithId = Request & { requestId: string };

/**
 * Minimal HTTP access-log middleware. No new dependencies — uses the
 * existing logger + `requestLogger(requestId)` child logger. Emits one
 * line per request after the response finishes: method, url, statusCode,
 * durationMs at `info` (or `warn` on 5xx). Request bodies are NEVER logged
 * (PII risk in a clinical system). The request-id is generated via
 * `crypto.randomUUID()` or echoed from the `X-Request-Id` header.
 */
function accessLogMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.headers["x-request-id"];
  const requestId =
    typeof incoming === "string" && incoming.length > 0
      ? incoming
      : (globalThis.crypto.randomUUID?.() ?? randomUuidFallback());

  (req as RequestWithId).requestId = requestId;
  const log = requestLogger(requestId);
  const t0 = Date.now();

  res.on("finish", () => {
    const durationMs = Date.now() - t0;
    const meta = {
      method: req.method,
      url: req.originalUrl ?? req.url,
      statusCode: res.statusCode,
      durationMs,
    };
    if (res.statusCode >= 500) {
      log.warn("request completed", meta);
    } else {
      log.info("request completed", meta);
    }
  });

  next();
}

/** Fallback UUID for runtimes without `globalThis.crypto.randomUUID`. */
function randomUuidFallback(): string {
  // Best-effort v4; only used if crypto.randomUUID is unavailable.
  const hex = "0123456789abcdef";
  let out = "";
  for (let i = 0; i < 36; i++) {
    if (i === 8 || i === 13 || i === 18 || i === 23) {
      out += "-";
    } else {
      out += hex[Math.floor(Math.random() * 16)];
    }
  }
  return out;
}

/**
 * Create and configure the Express application.
 *
 * Routes are composed into a public sub-router and mounted at `basePath`
 * (or "/" when empty). When a non-empty `basePath` is provided, an
 * additional root-level `/health` endpoint is registered for gateway probes.
 */
export function createApp(basePath: string): Express {
  const app: Express = express();

  // ── Middleware ────────────────────────────────────────────────────────

  app.use(
    cors({
      origin: settings.cors_origins,
      credentials: true,
      // Explicit lists — never `*` (no wildcard with credentials).
      methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Accept", "X-Request-Id"],
    }),
  );

app.use(express.json({ limit: "1mb" }));

// ── HTTP access logging (request-id + one line per request) ────────────
app.use(accessLogMiddleware);

// ── Compose public router ─────────────────────────────────────────────

  const spec = buildOpenapiSpec(basePath || undefined);

  const publicRouter = Router();
  // Incoming session validation gate — mounted before every route. Exempts
  // /health (both mount positions) and exactly /docs + /docs/* (including
  // /docs/openapi.json) via an inline path check in the middleware.
  publicRouter.use(requireSession);
  publicRouter.use("/indicadores", indicadoresRouter);
  publicRouter.use("/resultados", resultadosRouter);
  publicRouter.use("/conceptos", conceptosRouter);
  publicRouter.use("/metas", metasRouter);
  // Explicit GET route MUST precede swaggerUi.serve middleware, which
  // otherwise intercepts all /docs/* requests including /docs/openapi.json.
  publicRouter.get("/docs/openapi.json", (_req: Request, res: Response) => {
    res.json(spec);
  });
  publicRouter.use("/docs", swaggerUi.serve, swaggerUi.setup(spec));
  publicRouter.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "ok" });
  });

  // ── Mount public router ───────────────────────────────────────────────

  const mountPath = basePath || "/";
  app.use(mountPath, publicRouter);

  // Root-level health always available when prefix is set (gateway probes)
  if (basePath) {
    app.get("/health", (_req: Request, res: Response) => {
      res.json({ status: "ok" });
    });
  }

  // ── Error middleware ──────────────────────────────────────────────────

  app.use(errorMiddleware);

  return app;
}

/**
 * Centralized error middleware — classifies errors that escape route handlers
 * (via asyncHandler → next(err)) into proper HTTP responses.
 *
 * Extracted as an exported function so tests can mount it in the correct
 * stack order (after test routes) and verify classification in isolation.
 */
export function errorMiddleware(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof ZodError) {
    const first = err.issues[0];
    const field =
      first && first.path.length > 0
        ? String(first.path[first.path.length - 1])
        : "unknown";
    const message = first?.message ?? "Validation error";
    res.status(422).json({
      detail: { field, message },
    });
    return;
  }

  // Generic 500
  logger.error("Unhandled error", { err });
  res.status(500).json({
    detail: { message: "Error interno del servidor" },
  });
}

// ── Default app instance (production / local dev) ──────────────────────

const app = createApp(settings.base_path);

// ── Lifecycle ───────────────────────────────────────────────────────────

async function start(): Promise<void> {
  // Warn about default credentials in non-dev environments
  warnDefaultCredentials();

  if (settings.auth_disabled) {
    logger.warn(
      "[auth] AUTH_DISABLED=true — session and privilege checks BYPASSED. " +
        "Dev-only. Never enable in production.",
    );
  }

  // Verify database connectivity before syncing models
  try {
    await sequelize.authenticate();
    logger.info("PostgreSQL connection established.");
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    logger.error("Failed to connect to PostgreSQL", { error: message });
    process.exit(1);
  }

  // Sync Sequelize models with PostgreSQL (safe — does not drop data)
  await sequelize.sync();
  logger.info("PostgreSQL models synced.");

  // Dedup first: legacy data may hold several canonical rows per month,
  // which would make the UNIQUE index creation below fail.
  await deduplicateCanonicalResults();
  await ensureCanonicalResultIndex();
  logger.info("Canonical result index ensured.");

  // Backfill canonical fields for existing rows
  await backfillResultadoCanonical();

  // Create/refresh rollup views for SQL consumers
  await createRollupViews();

  if (settings.auto_seed_default_indicator) {
    const seeded = await seedDefaultIndicador();
    logger.info("Default indicator seeding finished", { seeded });
  }

  const server = app.listen(settings.port, () => {
    logger.info("Motor de Indicadores SIH.SALUS running", {
      url: `http://localhost:${settings.port}${settings.base_path || ""}`,
      port: settings.port,
      basePath: settings.base_path || "/",
    });
  });

  // Graceful shutdown
  const shutdown = async () => {
    logger.info("Shutting down...");
    server.closeIdleConnections?.();
    server.close();
    await disposeMysql();
    await sequelize.close();
    logger.info("Shutdown complete.");
    process.exit(0);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

// Only start when run directly (not when imported for tests)
const isMainModule =
  process.argv[1]?.endsWith("main.js") ||
  process.argv[1]?.endsWith("main.ts") ||
  process.argv[1]?.includes("tsx");

if (isMainModule) {
  start().catch((err) => {
    logger.error("Failed to start", { err });
    process.exit(1);
  });
}

export { app };
