/**
 * Express application entry point for Motor de Indicadores SIH.SALUS.
 *
 * - Creates the Express app with CORS and error middleware.
 * - Includes all three routers: indicadores, resultados, conceptos.
 * - Exposes a /health endpoint for monitoring.
 * - Lifecycle: Sequelize sync on startup, pool disposal on SIGTERM.
 */

import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import cors from "cors";
import { settings } from "./config/index.js";
import { sequelize } from "./database/postgres.js";
import { disposeMysql } from "./database/mysql.js";
import { indicadoresRouter } from "./routers/indicadores.js";
import { resultadosRouter } from "./routers/resultados.js";
import { conceptosRouter } from "./routers/conceptos.js";

const app = express();

// ── Middleware ──────────────────────────────────────────────────────────

app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "http://127.0.0.1:5173",
      "http://localhost:8080",
      "http://127.0.0.1:8080",
    ],
    credentials: true,
    methods: ["*"],
    allowedHeaders: ["*"],
  }),
);

app.use(express.json());

// ── Routers ─────────────────────────────────────────────────────────────

app.use("/indicadores", indicadoresRouter);
app.use("/resultados", resultadosRouter);
app.use("/conceptos", conceptosRouter);

// ── Health ──────────────────────────────────────────────────────────────

app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok" });
});

// ── Error middleware ────────────────────────────────────────────────────

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

// ── Lifecycle ───────────────────────────────────────────────────────────

async function start(): Promise<void> {
  // Sync Sequelize models with PostgreSQL (safe — does not drop data)
  await sequelize.sync();
  console.log("PostgreSQL models synced.");

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
