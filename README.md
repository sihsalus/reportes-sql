# Motor de Indicadores SIH.SALUS

Microservicio para definición, versionado y cálculo de indicadores clínicos.
Lee datos desde OpenMRS (MySQL, solo lectura), expone una API REST con
CRUD de indicadores, versionado semántico, y cálculo bajo demanda, y
almacena resultados en PostgreSQL.

## Quick start (local dev)

```bash
cp .env.example .env        # edit DB credentials as needed
yarn install --frozen-lockfile
yarn dev                     # http://localhost:8000
```

## Requirements

- Node.js 22+
- yarn 4+
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
| `INDICATORS_DB_HOST` | `localhost` | PostgreSQL host |
| `INDICATORS_DB_PORT` | `5432` | PostgreSQL port |
| `INDICATORS_DB_NAME` | `indicators` | PostgreSQL database name |
| `INDICATORS_DB_USER` | `postgres` | PostgreSQL user |
| `INDICATORS_DB_PASSWORD` | `postgres` | PostgreSQL password |
| `OPENMRS_DB_HOST` | `localhost` | OpenMRS MySQL host |
| `OPENMRS_DB_PORT` | `3306` | OpenMRS MySQL port |
| `OPENMRS_DB_NAME` | `openmrs` | OpenMRS MySQL database |
| `OPENMRS_DB_USER` | `openmrs` | OpenMRS MySQL user |
| `OPENMRS_DB_PASSWORD` | `openmrs` | OpenMRS MySQL password |
| `OPENMRS_API_URL` | `http://localhost/openmrs` | OpenMRS REST API base URL |
| `OPENMRS_API_USER` | `admin` | OpenMRS API basic-auth user |
| `OPENMRS_API_PASSWORD` | `Admin123` | OpenMRS API basic-auth password |
| `LOG_LEVEL` | `debug` (dev) / `info` (prod) | Minimum log level: `debug`, `info`, `warn`, `error` |

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
yarn dev
# API at http://localhost:8000
# Swagger at http://localhost:8000/docs
```

### Integrated local (with OpenMRS gateway prefix)

```bash
BASE_PATH=/openmrs/services/reportes-sql yarn dev
# API at http://localhost:8000/openmrs/services/reportes-sql
# Swagger at http://localhost:8000/openmrs/services/reportes-sql/docs
# Health probe at http://localhost:8000/health
```

### Local frontend override for `esm-indicadores-app`

If you want to run only the indicadores microfrontend against a standalone local
`reportes-sql` instance, use a local override in the frontend repo instead of
committing shared repo config:

```json
{
  "@sihsalus/esm-indicadores-app": {
    "reportesSqlApiPath": "http://127.0.0.1:8000"
  }
}
```

Notes:
- Put that override in your local `config/frontend.json` inside the frontend repo.
- Do not use the deprecated `indicatorsApiPath` key for this app.
- Do not commit that override unless the whole team explicitly wants the shared local default.

