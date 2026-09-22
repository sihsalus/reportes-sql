# Motor de Indicadores SIH.SALUS

Microservicio para definición, versionado y cálculo de indicadores clínicos.
Lee datos desde OpenMRS (MySQL, solo lectura), expone una API REST con
CRUD de indicadores, versionado semántico, y cálculo bajo demanda, y
almacena resultados en PostgreSQL.

## Quick start (local dev)

```bash
cp .env.example .env        # edit DB credentials as needed
yarn install --immutable
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
| `OPENMRS_API_PASSWORD` | `Admin123` | OpenMRS API basic-auth password; replace in configured environments |
| `OPENMRS_REQUIRED_PRIVILEGE` | _(unset)_ | Institutionally approved write/recalculation privilege; unset denies writes |
| `OPENMRS_DB_CONNECT_TIMEOUT_MS` | `10000` | MySQL connection timeout |
| `OPENMRS_DB_ACQUIRE_TIMEOUT_MS` | `10000` | MySQL pool acquisition timeout |
| `OPENMRS_DB_QUERY_TIMEOUT_MS` | `30000` | MySQL query timeout |

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

### Frontend and session contract

Use the same gateway origin as the OpenMRS SPA. The frontend setting remains
`reportesSqlApiPath: "/services/reportes-sql"`; `openmrsFetch` prepends the OpenMRS
base, normally `/openmrs`. With that base, the gateway forwards
`/openmrs/services/reportes-sql/*` without stripping the prefix, and this service
uses `BASE_PATH=/openmrs/services/reportes-sql`.

Business routes (`indicadores`, `resultados`, `conceptos`, `metas`) require a live
OpenMRS `JSESSIONID` session and the existing `app:indicadores` privilege. The
service revalidates the session on each request. It forwards only that cookie to
`OPENMRS_API_URL/ws/rest/v1/session`, with a three-second timeout and redirects
disallowed. Health and API documentation remain public.

Every mutation and recalculation additionally requires the exact privilege
configured in `OPENMRS_REQUIRED_PRIVILEGE`. An unset value denies writes. This PR
neither creates privileges nor assigns roles; choose an institutionally approved
privilege from the content repository and test effective privileges in the actual
OpenMRS session response. Do not substitute browser role checks for backend checks.
The catalogue service account (`OPENMRS_API_USER/PASSWORD`) is separate from the
operator's session and needs its own configured institutional credentials.

A standalone cross-origin URL is not a substitute for the gateway session setup.
Do not commit local API addresses, disable authentication, or enable frontend demo
data to work around an unavailable service. The frontend rejects 401/403 responses
and never simulates successful writes.

### Production (compiled)

```bash
yarn build && yarn start
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
docker run -p 127.0.0.1:8000:8000 --env-file .env reportes-sql
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
| `GET` | `/resultados/series` | Time-series rollup for an indicator (`?indicador_id=`, `?anio=`, optional `?granularity=`) |
| `POST` | `/resultados/recalcular-anio` | Batch-recalculate indicators for a year; `anio` and optional `indicador_id` are read from the request body |
| `GET` | `/conceptos/buscar?q=` | Search OpenMRS concepts |
| `GET` | `/conceptos/buscar/resolve?uuids=` | Batch-resolve concept UUIDs to display labels |
| `GET` | `/conceptos/encounter-types` | List encounter types |
| `GET` | `/conceptos/diagnosticos/buscar?q=` | Search diagnoses (CIE-10) |
| `GET` | `/conceptos/locations?q=` | Search locations |
| `GET` | `/conceptos/locations/resolve?uuids=` | Batch-resolve location UUIDs |
| `GET` | `/conceptos/diagnosticos/resolve?uuids=` | Batch-resolve diagnosis UUIDs |

*All business endpoints are prefixed when `BASE_PATH` is set.*

## Age filters

La edad se calcula **desde la fecha de nacimiento hasta la fecha del encuentro**,
no desde el inicio del período de reporte.

| Filtro | Cota | Operador |
|--------|------|----------|
| `min_dias` / `min_meses` / `min_anios` | Mínima | `>=` (inclusivo) |
| `max_dias` | Máxima | `<=` (inclusivo) |
| `max_meses_excl` | Máxima | `<` (exclusivo) |
| `max_anios_excl` | Máxima | `<` (exclusivo) |

**Ejemplo del mismo día**: con `max_anios_excl: 5` y fecha de nacimiento
`2020-06-15`, un encuentro el `2025-06-15` queda **excluido**
(el paciente cumple 5 años ese día). Para incluirlo se debe usar `max_dias`
o una cota mayor con `max_anios_excl`.

Solo se permite una cota mínima y una cota máxima a la vez.

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
yarn test              # run all tests
yarn test:watch        # watch mode
yarn test:coverage     # with coverage report
```

## Container image (GHCR)

The `publish.yml` workflow builds and pushes container images to GitHub
Container Registry as:

`ghcr.io/<owner-or-org>/reportes-sql`

The owner/org segment is resolved from the GitHub repository automatically.
The `ci.yml` workflow runs unit tests, build and a disposable database contract job. It does not publish.

### Published tags

| Git ref | Image tags |
|---------|-----------|
| `main` branch | `main`, `sha-<commit>`, `latest` |
| `v1.2.3` tag | `1.2.3`, `1.2`, `1` |

The publish workflow runs on pushes to `main` and on semver tags. It does
not run on pull requests, so PRs are not published as `pr-<number>` images.

### Pull the image

```bash
docker pull ghcr.io/<owner-or-org>/reportes-sql:latest
```

### Run from GHCR

```bash
docker run -p 127.0.0.1:8000:8000 \
  -e INDICATORS_DB_HOST=your-pg-host \
  -e INDICATORS_DB_PASSWORD=... \
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

## Definition, results and migration contract

- Definitions are immutable versions. POST creates the indicator and version 1
  atomically; PUT updates metadata and any new definition version atomically.
  Nested filters participate in version comparison. Unknown locations or encounter
  types are rejected before writes; an unavailable catalogue is an error.
- `conteo_atenciones` counts distinct encounters. Multiple matching diagnoses do
  not multiply encounters or satisfy a minimum number of encounters twice.
  Encounter type filters apply to all three supported count modes.
- `conteo_pacientes_ventana` attributes a patient to the month of the last qualifying
  encounter in the configured age window. This institutional definition must be
  approved before using the result operationally.
- Monthly calculations supersede earlier canonical rows while retaining history.
  A parent indicator row lock serializes competing calculations. Normal results
  exclude historical rows unless `include_historicos=true` is requested.
- Quarterly, half-year and annual API series add monthly values and return
  `versiones: number[]`. They are not distinct-patient counts across the whole
  aggregate period. Direct SQL views retain their per-version breakdown.
- Startup uses `sequelize.sync()` without `force` or `alter`. The new calculation
  ledger and metadata tables are additive. Canonical backfill v2 runs once in a
  transaction with a table lock: existing canonical rows take priority over legacy
  rows with no month; one winner is selected per indicator/month; explicit history
  stays historical. The migration marker commits with the rows. Failure rolls
  back and stops startup. No source OpenMRS rows are modified or deleted.

Before rollout, rehearse this startup against a recoverable, de-identified copy
of the indicators PostgreSQL database and compare row counts, historical results,
and approved expected calculations. Preserve the existing PostgreSQL volume and
OpenMRS database. Use an OpenMRS MySQL account with SELECT grants only, set
`AUTO_SEED_DEFAULT_INDICATOR=false`, configure the catalogue account and approved
write privilege, and pin coordinated frontend/backend image versions. The current
distribution configuration still needs that coordination. No production rollout
is implied by these drafts. Reverting an image does not reverse migrated canonical
flags; database rollback requires the verified PostgreSQL backup procedure.

## Database contract tests

`yarn test --runInBand` uses synthetic mocks and HTTP listeners; `yarn build`
checks production TypeScript. The CI job **PostgreSQL and MariaDB contract** then
runs `node scripts/test-database-contract.mjs` against fresh PostgreSQL 17 and
MariaDB 10.11 services. It checks real SQL counts, a read-only source account,
migration rollback/restart/history, concurrent calculations, atomic CRUD failure,
and the aggregate HTTP contract. It removes its own synthetic tables, views,
functions and reader account on completion.

The script requires `RUN_DATABASE_CONTRACT=synthetic-only`, loopback hosts and
empty databases named `reportes_sql_test`; the workflow defines all synthetic
settings. It refuses existing tables and must never target institutional data.
These tests do not replace OpenMRS session/role integration, gateway validation,
indicator definition approval, or management-user acceptance in DEV/QLTY.

## Integration provenance

This candidate carries forward Anderson's functional work through
`3f5fd70eae2184920b3063d0deda5ea416207460` from `dev`, with integration regressions
and fixes. Local authentication bypasses, private agent state, and unrelated
package cleanup from later commits are excluded. Track coordinated frontend,
configuration and institutional acceptance in
[sihsalus-frontend.tasktree#36](https://github.com/sihsalus/sihsalus-frontend.tasktree/issues/36).
