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
import { settings } from "./config/index.js";
import { sequelize } from "./database/postgres.js";
import { disposeMysql } from "./database/mysql.js";
import { backfillResultadoCanonical, createRollupViews } from "./database/views.js";
import { indicadoresRouter } from "./routers/indicadores.js";
import { resultadosRouter } from "./routers/resultados.js";
import { conceptosRouter } from "./routers/conceptos.js";
import { buildOpenapiSpec } from "./docs/openapi.js";
import { seedDefaultIndicador } from "./seed/default-indicador.js";

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
      methods: ["*"],
      allowedHeaders: ["*"],
    }),
  );

  app.use(express.json());

  // ── Compose public router ─────────────────────────────────────────────

  const spec = buildOpenapiSpec(basePath || undefined);

  const publicRouter = Router();
  publicRouter.use("/indicadores", indicadoresRouter);
  publicRouter.use("/resultados", resultadosRouter);
  publicRouter.use("/conceptos", conceptosRouter);
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

  // Zod validation error handler — catches ZodError from routes
  app.use(
    (err: unknown, _req: Request, res: Response, _next: NextFunction) => {
      if (err && typeof err === "object" && "name" in err && (err as Record<string, unknown>).name === "ZodError") {
        const zodErr = err as unknown as { issues: Array<{ path: (string | number)[]; message: string }> };
        const first = zodErr.issues[0];
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
      console.error("Unhandled error:", err);
      res.status(500).json({
        detail: "Error interno del servidor",
      });
    },
  );

  return app;
}

// ── Default app instance (production / local dev) ──────────────────────

const app = createApp(settings.base_path);

// ── Lifecycle ───────────────────────────────────────────────────────────

async function start(): Promise<void> {
  // Sync Sequelize models with PostgreSQL (safe — does not drop data)
  await sequelize.sync();
  console.log("PostgreSQL models synced.");

  // Backfill canonical fields for existing rows
  await backfillResultadoCanonical();

  // Create/refresh rollup views for SQL consumers
  await createRollupViews();

  if (settings.auto_seed_default_indicator) {
    const seeded = await seedDefaultIndicador();
    console.log(
      "Default indicator seeding finished:",
      JSON.stringify(seeded),
    );
  }

  const server = app.listen(settings.port, () => {
    console.log(
      `Motor de Indicadores SIH.SALUS running on port ${settings.port}`,
    );
  });

  // Graceful shutdown
  const shutdown = async () => {
    console.log("\nShutting down...");
    server.close();
    await disposeMysql();
    await sequelize.close();
    console.log("Shutdown complete.");
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
    console.error("Failed to start:", err);
    process.exit(1);
  });
}

export { app };
