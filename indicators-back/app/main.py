"""FastAPI application entry point for Motor de Indicadores SIH.SALUS.

Task 4.5:
- Creates the FastAPI app with title, version, and lifespan.
- Lifespan: lazy engine init on startup, dispose on shutdown.
- Includes all three routers: indicadores, resultados, conceptos.
- Exposes a /health endpoint for monitoring.
"""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers import conceptos, indicadores, resultados


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Manage database engine lifecycle.

    Startup: engines are lazy-initialized on first use — nothing to do.
    Shutdown: dispose both PostgreSQL and MySQL engines, releasing pools.
    """
    yield
    from app.database import dispose_engines

    await dispose_engines()


app = FastAPI(
    title="Motor de Indicadores SIH.SALUS",
    description=(
        "Microservicio para definición, versionado y cálculo de indicadores "
        "clínicos. Lee datos desde OpenMRS (MySQL, solo lectura) y almacena "
        "resultados en PostgreSQL."
    ),
    version="0.1.0",
    lifespan=lifespan,
)

# ── CORS ────────────────────────────────────────────────────────────────
# Allow the Vite dev server to communicate with the API.

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Routers ─────────────────────────────────────────────────────────────

app.include_router(
    indicadores.router, prefix="/indicadores", tags=["Indicadores"]
)
app.include_router(
    resultados.router, prefix="/resultados", tags=["Resultados"]
)
app.include_router(
    conceptos.router, prefix="/conceptos", tags=["Conceptos"]
)


# ── Health ──────────────────────────────────────────────────────────────


@app.get("/health", tags=["Health"])
async def health():
    """Basic health check endpoint — returns 200 when the app is running."""
    return {"status": "ok"}
