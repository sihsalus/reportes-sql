## Exploration: migrate-indicator-engine-to-typescript

Historical exploration retained as migration background. It describes the legacy Python service that was migrated; that source tree is no longer in this repository.

### Legacy Baseline

Before the migration, the project was a single Python/FastAPI backend microservice (Motor de Indicadores SIH.SALUS) with the following layered architecture:

```
app/
├── types/definicion.py    — Pydantic v2 metamodel (321 lines, zero ORM coupling)
├── engine/
│   ├── interpreter.py     — SQL builder (517 lines, pure string construction)
│   ├── executor.py        — MySQL→PostgreSQL bridge (137 lines)
│   └── periodo.py          — Period date calculation (41 lines)
├── models/indicador.py    — SQLAlchemy ORM (126 lines, 3 entities)
├── schemas/indicador.py   — Pydantic request/response DTOs (213 lines)
├── routers/
│   ├── indicadores.py     — CRUD + versioning + SQL preview (465 lines)
│   ├── resultados.py      — Filtered query + batch calculation (263 lines)
│   └── conceptos.py       — OpenMRS REST proxy (493 lines)
├── validators/openmrs.py   — OpenMRS existence checks (84 lines)
├── config.py               — pydantic-settings (73 lines)
├── database.py             — Dual-database lazy singletons (73 lines)
└── main.py                 — FastAPI entry point (116 lines)
```

**Key architectural invariants:**
- **Dual database**: PostgreSQL (async, read/write, app-owned) for metadata/results; MySQL (sync, read-only, external OpenMRS) for clinical data
- **Parameterized SQL only**: `%(name)s` PyMySQL syntax — zero string interpolation
- **Append-only versioning**: `IndicadorVersion` rows are immutable; new versions create new rows
- **UUID PKs globally**
- **Periodo bounds**: `periodo_inicio` inclusive, `periodo_fin` exclusive (internally: `fin_excl = fin + 1day`)
- **Error envelope**: `{detail: {field, message}}` — project convention, not FastAPI default list
- **Legacy JSONB backward compat**: Old flat format (`diagnostico`, `observaciones`, `eventos[]`) auto-normalized to nested `evento` shape via Pydantic `model_validator(mode='before')`
- **Concept UUID → concept_id resolution**: For `ordenes`, UUIDs resolved against `concept` table in OpenMRS MySQL at query-build time
- **Location UUID validation**: Existence checks against `location` table in OpenMRS at write time (I/O outside Pydantic models)
- **Age filter semantics**: Six canonical fields (`min_dias`, `min_meses`, `min_anios`, `max_dias`, `max_meses_excl`, `max_anios_excl`) with unit-aware SQL generation (DATEDIFF for days, DATE_ADD INTERVAL for months/years)

**Test coverage (1075+ lines):**
- `tests/test_engine_interpreter.py` — 615 lines, 25+ scenarios: SQL generation, date bounds, age filters, diagnostico JOINs, ordenes EXISTS, minimo_ocurrencias subquery, legacy normalization
- `tests/test_types_definicion.py` — 540 lines: Pydantic validation, mutual exclusivity, backward compat, canonical six-field age filter
- `tests/test_api.py` — 960 lines: Smoke tests, schema validation, UUID validation, PUT auto-versioning, SQL preview endpoint
- `tests/test_engine_executor.py` — 160 lines: Structure/import tests, execution path mock tests
- `tests/test_resultados.py` and `tests/test_conceptos.py` also exist

### Affected Areas During Migration

- **`app/types/definicion.py`** — The entire Pydantic metamodel. 321 lines of type definitions, validators, and legacy normalizers. This is the CANONICAL representation — every consumer depends on it. Must be translated to Zod with identical validation and normalization behavior.
- **`app/engine/interpreter.py`** — The SQL builder. 517 lines of pure MySQL SQL generation. All parameterized with `%(name)s` syntax. Must be rewritten to use `?` positional or `:name` named params for Node MySQL driver (mysql2). Critical: date-bound correctness (`fin_excl = fin + 1day`), age filter unit logic, subquery generation.
- **`app/engine/executor.py`** — MySQL execution + PostgreSQL persistence bridge. 137 lines. Must be adapted for Sequelize dual-database pattern. Sync MySQL read, async PostgreSQL write.
- **`app/engine/periodo.py`** — Period calculation. 41 lines of simple date math. Straightforward translation.
- **`app/models/indicador.py`** — SQLAlchemy ORM → Sequelize models. PostgreSQL-specific types (UUID, JSONB, Numeric(18,6)). Relationship definitions. UNIQUE constraint on `(indicador_id, version)`.
- **`app/schemas/indicador.py`** — Pydantic DTOs → Zod request/response schemas. Pagination envelopes, enriched responses, error shapes.
- **`app/routers/indicadores.py`** — FastAPI async CRUD → Express async handlers. Dependency injection (`Depends(get_db)`) → middleware or factory pattern. `TestClient` → supertest.
- **`app/routers/resultados.py`** — Batch calculation loop. OpenMRS concept resolution inline.
- **`app/routers/conceptos.py`** — OpenMRS REST proxy. httpx.AsyncClient → axios/node-fetch. CIE-10 extraction logic.
- **`app/validators/openmrs.py`** — OpenMRS MySQL existence checks. Simple query → Sequelize raw query.
- **`app/config.py`** — pydantic-settings → dotenv + typed config object.
- **`app/database.py`** — Dual-database lazy singletons → Sequelize instance management.
- **`app/main.py`** — FastAPI app → Express app. Lifespan → server start/stop hooks. CORS, error handlers.
- **All test files** — pytest → jest. `monkeypatch` → jest mocks. `TestClient` → supertest. Async test patterns.
- **`docker-compose.yml`** — Python/uvicorn → Node/Express container. Volume mounts, command, healthcheck.
- **`Dockerfile`** — Python → Node multi-stage.
- **`alembic/`** — Migration framework: alembic → sequelize-cli or umzug. Migration files must be rewritten.
- **`requirements.txt`** → `package.json` — All dependencies change.

### Approaches

1. **Incremental Module Replacement (recommended at the time)**
   — Build the TypeScript backend module by module, running alongside Python during transition. Start with project scaffold and config, then Zod types (the foundation), then models, then engine, then routers. Each module is independently testable.
   - Pros: Lowest risk — each module verified in isolation before integration; allows gradual rollout; can run Python and Node side-by-side during migration; preserves existing Python deployment as fallback.
   - Cons: Temporary dual-stack complexity; need to ensure both backends don't corrupt PostgreSQL; longer calendar time.
   - Effort: **High** (full rewrite of ~3000 lines of Python + ~2700 lines of tests), but spread across modules.

2. **Strangler Fig with API Gateway**
   — Deploy a reverse proxy (nginx/traefik) that routes `/indicadores/*` to Python and gradually shifts routes to Node as modules are completed. Full feature parity before cutover.
   - Pros: Zero-downtime migration; can test in production with real traffic; full rollback per-route.
   - Cons: Operational complexity (proxy config, dual deployment); potential for subtle divergence between backends; harder local dev setup.
   - Effort: **High** (same rewrite) + **Medium** (infra overhead).

3. **Big Bang Rewrite**
   — Complete TypeScript reimplementation, swap Docker containers atomically. All tests pass before cutover.
   - Pros: Clean cut — no dual-stack maintenance; single codebase from day one; simpler final deployment.
   - Cons: Highest risk — no gradual validation; long development window before any value; if tests miss edge cases, production breaks with no fallback; requires complete test parity before confidence.
   - Effort: **High** (same rewrite) with higher integration risk.

### Historical Recommendation

**Approach 1: Incremental Module Replacement** with the following module ordering:

| Phase | Module | Complexity | Dependency |
|-------|--------|-----------|------------|
| 0 | Project scaffold, config, database | Low | None |
| 1 | Zod type schemas (`app/types/definicion.py`) | High | Phase 0 |
| 2 | Sequelize models (`app/models/indicador.py`) | Medium | Phase 0 |
| 3 | Engine — SQL builder (`app/engine/interpreter.py`) | **Very High** | Phase 1 |
| 4 | Engine — executor (`app/engine/executor.py`) | Medium | Phase 0, 2, 3 |
| 5 | Engine — periodo (`app/engine/periodo.py`) | Low | None |
| 6 | Validators (`app/validators/openmrs.py`) | Low | Phase 0 |
| 7 | Router — conceptos (simplest, just a proxy) | Medium | Phase 0 |
| 8 | Router — indicadores (CRUD + versioning) | High | Phases 1, 2, 6 |
| 9 | Router — resultados (query + batch calc) | High | Phases 1-6, 8 |
| 10 | Express app entry point + middleware | Low | Phases 7-9 |
| 11 | Docker + deployment config | Low | Phase 10 |
| 12 | Test suite rewrite (jest + supertest) | High | All phases |
| 13 | Remove Python codebase | Low | Phase 12 passes |

**Why this ordering**: Phase 1 (Zod types) is the foundation — everything depends on it. Phase 3 (SQL builder) is the highest risk and highest complexity module (517 lines of intricate SQL generation with 25+ test scenarios). By doing it early after the foundation, we de-risk the hardest piece. Phase 8-9 (routers) come last because they integrate everything. Phase 12 (tests) runs incrementally alongside each phase — not a separate phase.

### Risks

- **SQL parameterization syntax mismatch**: PyMySQL uses `%(name)s` syntax (e.g., `%(inicio)s`, `%(fin_excl)s`). mysql2 uses `?` positional parameters. Every `build_query` output must convert from named to positional params. The params dict currently uses Python-specific `{key: value}` where keys are embedded in SQL — this MUST be rewritten to positional or `:name` named params. **Mitigation**: Use mysql2's named parameter support (`:name` syntax) which is closer to `%(name)s` — just a string replacement of `%(name)s` → `:name`. Verify with integration tests.
- **Pydantic `model_validator(mode='before')` → Zod `preprocess`/`transform`**: The legacy normalization logic (300+ lines) is complex and easy to get wrong. Mixing legacy + canonical fields must be rejected. Idempotent double-parse must be preserved. **Mitigation**: Implement as Zod `preprocess` + `superRefine`; port ALL 540 lines of type validation tests before touching engine.
- **Sequelize dual-database pattern**: SQLAlchemy has explicit sync/async engine separation. Sequelize uses connection pools per instance. Need to verify Sequelize can manage two separate databases (PostgreSQL + MySQL) with different read/write semantics. **Mitigation**: Sequelize supports multiple instances natively. Create `sequelizePg` (read/write) and `sequelizeMySql` (read-only) instances.
- **Test parity gap**: 1075+ lines of Python tests with complex mocking. If tests are not fully ported, bugs will escape. pytest fixtures, `monkeypatch`, `TestClient`, async test patterns — all need jest equivalents. **Mitigation**: Port tests file-by-file as each module is completed. Use `supertest` for HTTP, manual mocks for DB, `jest.mock()` for patching.
- **Legacy JSONB rows in production**: Existing PostgreSQL `indicador_version.definicion` columns contain old-format JSONB (flat `diagnostico`, `observaciones`, `eventos[]`). The new Zod schemas MUST parse both old and new formats identically to Pydantic's behavior. **Mitigation**: Comprehensive backward-compat tests with real old-format JSON fixtures from the Python test suite.
- **Express async error handling**: FastAPI catches async exceptions automatically. Express 5 has partial async support but still requires explicit error handling middleware. Uncaught promise rejections can crash the process. **Mitigation**: Use `express-async-errors` or wrap all route handlers in `try/catch` with a shared error handler middleware.
- **Sequelize migration divergence**: alembic generates sequential revision files. sequelize-cli uses timestamped files. Migration logic must be manually translated — no automated conversion. **Mitigation**: Document all three existing alembic migrations, rewrite as sequelize migrations, verify against existing PostgreSQL schema.
- **Numeric precision**: `IndicadorResultado.valor` uses `Numeric(18,6)`. Sequelize's `DataTypes.DECIMAL(18,6)` should match, but float↔decimal rounding in JavaScript is different from Python's `Decimal`. **Mitigation**: Use `DECIMAL` type and parse results as strings before converting to numbers for API responses.

### Ready for Proposal

**Yes**. At the time of writing, all major unknowns were identified and this exploration was sufficient to proceed with the proposal. It is kept as historical context for how the current TypeScript codebase was planned.
