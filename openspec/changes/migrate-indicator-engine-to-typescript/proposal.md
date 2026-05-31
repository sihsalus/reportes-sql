# Proposal: Migrate Indicator Engine to TypeScript

## Intent

Move the Python/FastAPI backend to Node.js/TypeScript, aligned with Generador-de-FUA, while preserving current API behavior, SQL semantics, dual-database usage, and data compatibility.

## Scope

### In Scope
- TypeScript/Express/Sequelize/Zod/Jest backend with feature parity for `app/` and `tests/`.
- Incremental migration by slices: foundation, engine parity, API parity, infra cutover.
- Preservation of invariants: parameterized SQL, append-only versioning, UUID PKs, exclusive `periodo_fin`, legacy JSON normalization, error envelope.

### Out of Scope
- New business rules, endpoint redesign, or schema changes beyond migration needs.
- Proxy-based strangler rollout, frontend changes, or OpenMRS domain expansion.

## Capabilities

### New Capabilities
- `indicator-definition-validation`: Zod schemas and legacy normalization equivalent to `app/types/definicion.py`.
- `indicator-query-engine`: SQL build/execute behavior parity for MySQL reads and PostgreSQL result persistence.
- `indicator-management-api`: CRUD, versioning, SQL preview, and batch execution parity for indicadores/resultados.
- `openmrs-concept-proxy`: Concept lookup and validation parity for `conceptos` and OpenMRS checks.

### Modified Capabilities
None.

## Approach

Incremental module replacement. Build TS foundation first (`config`, DB clients, Zod, Sequelize), then port the SQL builder early as the highest-risk slice, then APIs, then container/migration cutover. Keep Python deployable until TS parity tests pass.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `app/types`, `app/schemas` | Modified | Source behavior to port into Zod contracts |
| `app/engine/*` | Modified | SQL generation, execution, periodo invariants |
| `app/models`, `alembic/` | Modified | Sequelize models and migration replacement |
| `app/routers/*`, `app/main.py` | Modified | Express route parity and error handling |
| `tests/*` | Modified | Jest/supertest parity suite |
| `Dockerfile`, `docker-compose.yml`, `requirements*.txt` | Modified | Node runtime cutover |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| SQL param/semantic drift | High | Port interpreter tests first; use named params |
| Legacy JSON normalization mismatch | High | Port validation fixtures before engine rollout |
| Dual-DB/runtime divergence | Med | Separate Sequelize instances and parity integration tests |

## Rollback Plan

Ship in slices, keep Python service deployable, and cut over only after parity tests and smoke checks. If TS fails, revert traffic/container to Python and keep PostgreSQL schema/data unchanged.

## Dependencies

- Finalize TS stack choices to match Generador-de-FUA: Express, Sequelize, Zod, Jest, mysql2, PostgreSQL.

## Success Criteria

- [ ] TypeScript service matches current endpoint and validation behavior for covered flows.
- [ ] Existing invariant-heavy tests are ported and passing for types, engine, and API slices.
- [ ] Production cutover can be reversed to Python without data repair.
