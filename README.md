# Motor de Indicadores SIH.SALUS

Microservicio para definición, versionado y cálculo de indicadores clínicos.
Lee datos desde OpenMRS (MySQL, solo lectura), expone una API REST con
CRUD de indicadores, versionado semántico, y cálculo bajo demanda, y
almacena resultados en PostgreSQL.

## Quick start (local dev)

```bash
cp .env.example .env        # edit DB credentials as needed
pnpm install --frozen-lockfile
pnpm dev                     # http://localhost:8000
```

## Requirements

- Node.js 22+
- pnpm 11+
- PostgreSQL 12+ (for indicator storage)
- Access to an OpenMRS instance (MySQL + REST API)

## Environment variables

Copy `.env.example` to `.env` and adjust for your environment.

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8000` | HTTP listen port |
| `BASE_PATH` | _(empty)_ | Path prefix when behind a gateway (see below) |
| `CORS_ORIGINS` | `localhost:5173,localhost:8080` | Comma-separated allowed CORS origins |
| `AUTO_SEED_DEFAULT_INDICATOR` | `true` | Seed a default indicator on startup |
| `INDICADORES_DB_HOST` | `localhost` | PostgreSQL host |
| `INDICADORES_DB_PORT` | `5432` | PostgreSQL port |
| `INDICADORES_DB_NAME` | `indicators` | PostgreSQL database name |
| `INDICADORES_DB_USER` | `postgres` | PostgreSQL user |
| `INDICADORES_DB_PASSWORD` | `postgres` | PostgreSQL password |
| `OPENMRS_DB_HOST` | `localhost` | OpenMRS MySQL host |
| `OPENMRS_DB_PORT` | `3306` | OpenMRS MySQL port |
| `OPENMRS_DB_NAME` | `openmrs` | OpenMRS MySQL database |
| `OPENMRS_DB_USER` | `openmrs` | OpenMRS MySQL user |
| `OPENMRS_DB_PASSWORD` | `openmrs` | OpenMRS MySQL password |
| `OPENMRS_API_URL` | `http://localhost/openmrs` | OpenMRS REST API base URL |
| `OPENMRS_API_USER` | `admin` | OpenMRS API basic-auth user |
| `OPENMRS_API_PASSWORD` | `Admin123` | OpenMRS API basic-auth password |

## BASE_PATH

`BASE_PATH` prefixes all API routes so the service works behind a reverse
proxy or API gateway without URL rewriting. When set, business routes are
mounted under the prefix while `/health` remains available at root for
gateway probes.

| Scenario | BASE_PATH | Resulting routes |
|----------|-----------|-----------------|
| Standalone dev | _(empty)_ | `/indicadores`, `/resultados`, `/conceptos`, `/docs`, `/health` |
| Integrated behind gateway | `/openmrs/services/reportes-sql` | `/openmrs/services/reportes-sql/indicadores`, … |
| Health probe (always) | any | `/health` always responds at root |

The OpenAPI spec server URL, Swagger UI, and all route responses are
automatically adjusted to include the prefix when BASE_PATH is set.

## Running

### Standalone local (no prefix)

```bash
pnpm dev
# API at http://localhost:8000
# Swagger at http://localhost:8000/docs
```

### Integrated local (with OpenMRS gateway prefix)

```bash
BASE_PATH=/openmrs/services/reportes-sql pnpm dev
# API at http://localhost:8000/openmrs/services/reportes-sql
# Swagger at http://localhost:8000/openmrs/services/reportes-sql/docs
# Health probe at http://localhost:8000/health
```

### Production (compiled)

```bash
pnpm build && pnpm start
```

### Docker (dev stack)

```bash
docker compose up -d
# API at http://localhost:8000, PostgreSQL at localhost:5433
```

The compose file starts a PostgreSQL container and mounts `./src` for
hot reload via `tsx watch`. It targets the `dev` Dockerfile stage.

### Docker (production image)

```bash
docker build -t reportes-sql .
docker run -p 8000:8000 --env-file .env reportes-sql
```

The production image:
- Runs as non-root (`app` user)
- Includes only production dependencies
- Exposes port `8000` with a Docker `HEALTHCHECK` on `/health`
- Supports all env vars documented above

## API endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check |
| `GET` | `/docs` | Swagger UI |
| `GET` | `/docs/openapi.json` | OpenAPI spec |
| `GET` | `/indicadores` | List indicators (paginated) |
| `POST` | `/indicadores` | Create indicator |
| `GET` | `/indicadores/{id}` | Get indicator with versions |
| `PUT` | `/indicadores/{id}` | Update indicator (auto-versions) |
| `DELETE` | `/indicadores/{id}` | Soft-delete indicator |
| `POST` | `/indicadores/{id}/versiones` | Create new immutable version |
| `GET` | `/indicadores/{id}/preview-sql` | Preview generated SQL |
| `GET` | `/resultados` | List pre-calculated results |
| `POST` | `/resultados/calcular-ahora` | Batch-calculate all active indicators |
| `GET` | `/conceptos/buscar?q=` | Search OpenMRS concepts |
| `GET` | `/conceptos/encounter-types` | List encounter types |
| `GET` | `/conceptos/diagnosticos/buscar?q=` | Search diagnoses (CIE-10) |
| `GET` | `/conceptos/locations?q=` | Search locations |
| `GET` | `/conceptos/locations/resolve?uuids=` | Batch-resolve location UUIDs |
| `GET` | `/conceptos/diagnosticos/resolve?uuids=` | Batch-resolve diagnosis UUIDs |

*All business endpoints are prefixed when `BASE_PATH` is set.*

## Project structure

```
.
├── src/                     # Express TypeScript application
│   ├── config/             # Environment configuration (dotenv)
│   ├── database/           # PostgreSQL (Sequelize) and MySQL connections
│   ├── docs/               # OpenAPI spec builder
│   ├── engine/             # Indicator calculation logic
│   ├── models/             # Sequelize models
│   ├── routers/            # Express route handlers
│   ├── seed/               # Default indicator seeding
│   ├── types/              # Zod type definitions
│   ├── validators/         # Request validators
│   └── main.ts             # Entry point (Express app + lifecycle)
├── tests/                  # Jest test suite
├── docker-compose.yml      # Dev stack (app + PostgreSQL)
├── Dockerfile              # Multi-stage (dev + production)
├── .github/workflows/      # CI and GHCR publish
└── package.json
```

## Tests

```bash
pnpm test              # run all tests
pnpm test:watch        # watch mode
pnpm test:coverage     # with coverage report
```

## Container image (GHCR)

The CI workflow publishes container images to GitHub Container Registry as:

`ghcr.io/<owner-or-org>/reportes-sql`

The owner/org segment is resolved from the GitHub repository automatically.

### Published tags

| Git ref | Image tags |
|---------|-----------|
| `main` branch | `main`, `sha-<commit>`, `latest` |
| `v1.2.3` tag | `1.2.3`, `1.2`, `1` |
| Pull request | `pr-<number>` |

### Pull the image

```bash
docker pull ghcr.io/<owner-or-org>/reportes-sql:latest
```

### Run from GHCR

```bash
docker run -p 8000:8000 \
  -e INDICADORES_DB_HOST=your-pg-host \
  -e INDICADORES_DB_PASSWORD=... \
  -e OPENMRS_DB_HOST=your-openmrs-host \
  -e OPENMRS_API_URL=https://your-openmrs/openmrs \
  ghcr.io/<owner-or-org>/reportes-sql:latest
```

### Publishing a new version

Push a semver tag to trigger a versioned build:

```bash
git tag v1.0.0
git push origin v1.0.0
```

The `publish.yml` workflow builds, tags, and pushes to GHCR automatically.
