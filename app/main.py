"""FastAPI application entry point for Motor de Indicadores SIH.SALUS.

Task 4.5:
- Creates the FastAPI app with title, version, and lifespan.
- Lifespan: lazy engine init on startup, dispose on shutdown.
- Includes all three routers: indicadores, resultados, conceptos.
- Exposes a /health endpoint for monitoring.
"""

from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

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


# ── Exception Handlers ──────────────────────────────────────────────────


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(
    _request: Request, exc: RequestValidationError
) -> JSONResponse:
    """Return Pydantic validation errors in the project {detail: {...}} shape.

    Unlike the default FastAPI handler (which returns a list), this
    projects a single dict with ``field``, ``message``, and the first
    error's location so the frontend can display a structured message.
    """
    errors = exc.errors()
    if not errors:
        return JSONResponse(
            status_code=422,
            content={"detail": "Validation error"},
        )

    first = errors[0]
    # loc is a tuple like ('body', 'definicion', 'poblacion')
    # Use the deepest path component as the field identifier.
    loc = list(first.get("loc", []))
    field = loc[-1] if loc else "unknown"

    return JSONResponse(
        status_code=422,
        content={
            "detail": {
                "field": field,
                "message": str(first.get("msg", "Validation error")),
            }
        },
    )

# ── CORS ────────────────────────────────────────────────────────────────
# Allow the Vite dev server to communicate with the API.

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:8080",
        "http://127.0.0.1:8080",
    ],
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
