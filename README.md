# Motor de Indicadores SIH.SALUS

Microservicio para definición, versionado y cálculo de indicadores clínicos.
Lee datos desde OpenMRS (MySQL, solo lectura), expone una API REST con
CRUD de indicadores y de metas anuales (con versionado incremental), cálculo
de resultados bajo demanda y programado, y un proxy de conceptos, ubicaciones y
diagnósticos de OpenMRS. Almacena resultados en PostgreSQL.

## Quick start (local dev)

```bash
cp .env.example .env        # edit DB credentials as needed
yarn install --immutable
yarn dev                     # http://localhost:8000
```

## Requirements

- Node.js 22+
- yarn 4+
- PostgreSQL (for indicator storage; the bundled `docker-compose.yml`
  provisions PostgreSQL 17)
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
| `AUTO_REGISTER_CATALOG` | `true` | Register the official indicator catalog on startup |
| `RECALC_HOUR` | `2` | Hour (0-23, `America/Lima`) the nightly recalculation runs |
| `RECALC_WINDOW_MONTHS` | `3` | Rolling window of months to recalculate (current + previous). Legacy alias: `RECALC_VENTANA_MESES` |
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
| `OPENMRS_API_URL` | `http://localhost/openmrs` | OpenMRS REST API base URL (the conceptos proxy calls it with the caller's session cookie — no service credentials) |
| `LOG_LEVEL` | `debug` (dev) / `info` (prod) | Minimum log level: `debug`, `info`, `warn`, `error` |

Legacy env aliases still work: `INDICADORES_DB_*` for `INDICATORS_DB_*`, and
`RECALC_VENTANA_MESES` for `RECALC_WINDOW_MONTHS` (the canonical name wins when
both are set).

## Autorización (privilegios)

El servicio exige una sesión OpenMRS válida (`JSESSIONID`) en todas las rutas
salvo `/health` y `/docs`/`/docs/*`. Además:

- **Lectura / acceso al módulo**: toda ruta exige el privilegio
  `app:indicadores`, el mismo que usa el frontend para mostrar el módulo.
- **Escritura** (POST/PUT/DELETE): exige además el privilegio
  `app:indicadores.editar`.

Ambos nombres están **fijos en código** (no son variables de entorno): el
nombre vive en el código y su definición en la metadata (`sihsalus-content`),
como en OpenMRS. Los privilegios deben existir y estar asignados a los roles en
`sihsalus-content`.

Los super usuarios (roles `System Developer` o
`Application: Has Super User Privileges`) pasan ambos controles, igual que en el
frontend.

## API

Todas las rutas requieren una sesión OpenMRS y el privilegio `app:indicadores`
(ver [Autorización](#autorización-privilegios)); las escrituras requieren además
`app:indicadores.editar`. La documentación interactiva (Swagger UI) se sirve en
`/docs`.

| Grupo | Rutas |
|-------|-------|
| Indicadores | `GET/POST /indicadores`, `GET/PUT/DELETE /indicadores/:id`, `POST /indicadores/:id/versiones`, `GET /indicadores/:id/preview-sql` |
| Resultados | `GET /resultados` (filtros `indicador_id`, `version_id`, `periodo_inicio`, `periodo_fin`, `include_historicos`, `page`, `size`), `GET /resultados/series` (`indicador_id`, `anio`, `granularity`, `include_meta`), `POST /resultados/calcular-ahora`, `POST /resultados/recalcular-anio` |
| Metas | `PUT /metas` (upsert), `GET /metas`, `DELETE /metas` |
| Conceptos | `GET /conceptos/encounter-types`, `GET /conceptos/buscar`, `GET /conceptos/buscar/resolve`, `GET /conceptos/diagnosticos/buscar`, `GET /conceptos/diagnosticos/resolve`, `GET /conceptos/locations`, `GET /conceptos/locations/resolve` |
| Health | `GET /health` (público) |

## BASE_PATH

`BASE_PATH` prefixes all API routes so the service works behind a reverse
proxy or API gateway without URL rewriting. When set, business routes are
mounted under the prefix while `/health` remains available at root for
gateway probes.

| Scenario | BASE_PATH | Resulting routes |
|----------|-----------|-----------------|
| Standalone dev | _(empty)_ | `/indicadores`, `/resultados`, `/metas`, `/conceptos`, `/docs`, `/health` |
| Integrated behind gateway | `/openmrs/services/reportes-sql` | `/openmrs/services/reportes-sql/indicadores`, … |
| Health probe (always) | any | `/health` always responds at root |

The OpenAPI spec server URL, Swagger UI, and all route responses are
automatically adjusted to include the prefix when BASE_PATH is set.

## Recalculo programado

The service runs an in-process scheduler (no external cron — the calculation
endpoints require an OpenMRS session) that, once per day at `RECALC_HOUR`
(America/Lima), recalculates a rolling window of `RECALC_WINDOW_MONTHS` months
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

### Local stack with Docker Compose

`docker-compose.yml` builds the `dev` stage (hot reload + dev dependencies),
provisions a PostgreSQL 17 container, and expects OpenMRS to be reachable
(defaults to `host.docker.internal`).

```bash
docker compose up -d
# API at http://localhost:8000
# Postgres published on the host at port 5433
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

### Production build

```bash
yarn build   # tsc → dist/
yarn start   # node dist/main.js
```

## Tests

```bash
yarn test           # run the Jest suite once
yarn test:watch     # watch mode
yarn test:coverage  # with coverage report
```
