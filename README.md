# Motor de Indicadores SIH.SALUS

Microservicio para definición, versionado y cálculo de indicadores clínicos.
Lee datos desde OpenMRS (MySQL, solo lectura), expone una API REST con
CRUD de indicadores, versionado semántico, cálculo bajo demanda y programado, y
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

## Database schema

The PostgreSQL schema (indicator tables and rollup views) is created on
startup with `sequelize.sync()`. That call only **creates missing tables and
views**; it never alters existing ones, and there are no migrations yet.

Changing a column type therefore does **not** upgrade an existing database.
Recreate the affected tables and restart the service:

```sql
DROP TABLE IF EXISTS indicador_meta, indicador_calculo_log, indicador_resultado,
                     indicador_version, indicador CASCADE;
```

The official catalog is re-registered on startup when `AUTO_REGISTER_CATALOG`
is enabled, and results/metas can be recomputed. `app_metadata` is left
untouched on purpose.

## Environment variables

Copy `.env.example` to `.env` and adjust for your environment.

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8000` | HTTP listen port |
| `BASE_PATH` | _(empty)_ | Path prefix when behind a gateway (see below) |
| `CORS_ORIGINS` | `localhost:5173,localhost:8080` | Comma-separated allowed CORS origins |
| `AUTO_REGISTER_CATALOG` | `true` | Register the official indicator catalog on startup |
| `RECALC_HOUR` | `2` | Hour (0-23, `America/Lima`) the nightly recalculation runs |
| `RECALC_VENTANA_MESES` | `3` | Rolling window of months to recalculate (current + previous) |
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
| `OPENMRS_DB_CONNECT_TIMEOUT_MS` | `10000` | TCP connect handshake ceiling (ms) — fail-fast against a stuck OpenMRS DB |
| `OPENMRS_DB_ACQUIRE_TIMEOUT_MS` | `10000` | Time waiting for an idle pool connection (ms); enforced by the application because mysql2 lacks a PoolOptions acquireTimeout |
| `OPENMRS_DB_QUERY_TIMEOUT_MS` | `30000` | Per-query execution ceiling (ms) — increase only for very large OpenMRS datasets |
| `OPENMRS_API_URL` | `http://localhost/openmrs` | OpenMRS REST API base URL |
| `OPENMRS_API_USER` | `admin` | OpenMRS API basic-auth user |
| `OPENMRS_API_PASSWORD` | `Admin123` | OpenMRS API basic-auth password |
| `OPENMRS_REQUIRED_PRIVILEGE` | _(unset)_ | OpenMRS privilege required for writes (POST/PUT/DELETE). Empty = fail-closed for non-super users (403); super users (roles `System Developer`, `Application: Has Super User Privileges`) always pass |
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

## Recalculo programado

The service runs an in-process scheduler (no external cron — the calculation
endpoints require an OpenMRS session) that, once per day at `RECALC_HOUR`
(America/Lima), recalculates a rolling window of `RECALC_VENTANA_MESES` months
(the current month plus previous ones) for every active indicator. Recomputing
recent closed months absorbs late OpenMRS data entry; the current month stays
fresh and is provisional until it closes. On startup it also runs a one-off
catch-up of any month of the current year still missing results.

Every attempt is recorded in `indicador_calculo_log` with
`fuente = "scheduler"` (nightly) or `"scheduler-catchup"` (startup). The
manual endpoints `POST /resultados/calcular-ahora` and
`POST /resultados/recalcular-anio` are unaffected.

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

### Integrated local dev inside the SIH.SALUS stack

To run this local `reportes-sql` source behind the full `sihsalus` stack
(gateway + OpenMRS + MariaDB), build a local image and point the stack at it.
The stack's `compose/indicadores.yml` reads the image from two environment
variables, so no committed file changes are needed.

```bash
# 1. Build an image from this working copy (the name is arbitrary, but must match .env)
docker build -t sihsalus-reportes-sql:local .

# 2. In the sihsalus repo, add to its .env (gitignored):
#    REPORTES_SQL_IMAGE=sihsalus-reportes-sql
#    REPORTES_SQL_TAG=local
#    SIHSALUS_REPORTES_SQL_DB_PASSWORD=<any local password>   # the profile's Postgres requires it

# 3. Bring up the indicadores profile (from the sihsalus repo)
cd ../sihsalus
docker compose --profile indicadores up -d reportes-sql
```

The gateway exposes it at `/openmrs/services/reportes-sql` (`BASE_PATH` is set
by the compose file). To pick up code changes, rebuild the image and restart the
container:

```bash
docker build -t sihsalus-reportes-sql:local .
cd ../sihsalus && docker compose --profile indicadores up -d reportes-sql
```

Verify with `curl http://localhost/openmrs/services/reportes-sql/health` (expects
`200`). Remove the two `REPORTES_SQL_*` variables to fall back to the published
image.
