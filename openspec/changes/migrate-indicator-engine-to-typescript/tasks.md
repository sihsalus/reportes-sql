# Tasks: Migrate Indicator Engine to TypeScript

Migration record only. The repository now runs on TypeScript; the Python source tree referenced below has already been removed.

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 2500–3500 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 → PR 2 → PR 3 → PR 4 |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Foundation: TS config, DB clients, Zod schemas | PR 1 | base=main; includes Jest setup |
| 2 | Engine parity: SQL builder + executor + periodo | PR 2 | base=PR 1 branch; highest risk |
| 3 | Models + API parity: Sequelize routers + concept proxy | PR 3 | base=PR 2 branch |
| 4 | Infra cutover + verification gate | PR 4 | base=PR 3 branch; Docker, final TS smoke coverage |

## Phase 1: Foundation

- [x] 1.1 Create `package.json`, `tsconfig.json`, and Jest config
- [x] 1.2 Create `src/config/index.ts` with typed env via `dotenv`
- [x] 1.3 Create `src/database/postgres.ts` with Sequelize PG instance
- [x] 1.4 Create `src/database/mysql.ts` with mysql2 pool for OpenMRS
- [x] 1.5 Create `src/types/definicion.ts` with Zod schemas and legacy `.preprocess()`
- [x] 1.6 Write Jest parity tests for validation and normalization

## Phase 2: Engine Parity

- [x] 2.1 Create `src/engine/periodo.ts` with date boundary algorithm
- [x] 2.2 Create `src/engine/interpreter.ts` translating Zod defs to parameterized MySQL
- [x] 2.3 Create `src/engine/executor.ts` with mysql2 queries + Sequelize result persistence
- [x] 2.4 Write Jest parity tests for SQL strings, params, and periodo math

## Phase 3: Models and API Parity

- [x] 3.1 Create `src/models/indicador.ts` with Indicador, IndicadorVersion, IndicadorResultado
- [x] 3.2 Create `src/routers/conceptos.ts` with OpenMRS proxy and CIE-10 extraction
- [x] 3.3 Create `src/routers/indicadores.ts` with CRUD, versioning, preview
- [x] 3.4 Create `src/routers/resultados.ts` with batch calculation endpoint
- [x] 3.5 Write Jest integration tests for routers with mocked DBs

## Phase 4: Infra Cutover and Gate

- [x] 4.1 Create `src/main.ts` with Express bootstrap, CORS, error middleware
- [x] 4.2 Update `Dockerfile` to multi-stage Node build
- [x] 4.3 Update `docker-compose.yml` to Node service
- [ ] 4.4 Run TS E2E smoke suite in Docker to close the final environment-level verification gap
- [x] 4.5 Remove legacy Python artifacts (`app/`, `requirements*.txt`, `alembic/`)
