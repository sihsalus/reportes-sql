# Proposal: Migrate Indicator Engine to TypeScript

Historical proposal retained for migration context. The migration has since landed; the repository is now TypeScript-based and the old Python source tree is no longer present.

## Intent

Replace the former Python/FastAPI backend with Node.js/TypeScript, aligned with Generador-de-FUA, while preserving API behavior, SQL semantics, dual-database usage, and data compatibility.

## Scope

### In Scope
- TypeScript/Express/Sequelize/Zod/Jest backend with feature parity for the legacy backend behavior and migrated test coverage.
- Incremental migration by slices: foundation, engine parity, API parity, infra cutover.
- Preservation of invariants: parameterized SQL, append-only versioning, UUID PKs, exclusive `periodo_fin`, legacy JSON normalization, error envelope.

### Out of Scope
- New business rules, endpoint redesign, or schema changes beyond migration needs.
- Proxy-based strangler rollout, frontend changes, or OpenMRS domain expansion.

## Capabilities

### New Capabilities
- `indicator-definition-validation`: Zod schemas and legacy normalization equivalent to the removed Python definition model.
- `indicator-query-engine`: SQL build/execute behavior parity for MySQL reads and PostgreSQL result persistence.
- `indicator-management-api`: CRUD, versioning, SQL preview, and batch execution parity for indicadores/resultados.
- `openmrs-concept-proxy`: Concept lookup and validation parity for `conceptos` and OpenMRS checks.

### Modified Capabilities
None.

## Approach

Incremental module replacement. Build TS foundation first (`config`, DB clients, Zod, Sequelize), then port the SQL builder early as the highest-risk slice, then APIs, then container/migration cutover. This document describes the migration path that produced the current TS codebase.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| Legacy Python source tree | Replaced | Source behavior ported into `src/` TypeScript modules |
| `src/**/*` | Added | Current implementation for engine, routers, models, config, and validation |
| `tests/*` | Modified | Jest/supertest coverage for the TS implementation |
| `Dockerfile`, `docker-compose.yml` | Modified | Node runtime cutover |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| SQL param/semantic drift | High | Port interpreter tests first; use named params |
| Legacy JSON normalization mismatch | High | Port validation fixtures before engine rollout |
| Dual-DB/runtime divergence | Med | Separate Sequelize instances and parity integration tests |

## Rollback Plan

Ship in slices, keep the legacy service deployable during transition, and cut over only after parity tests and smoke checks. This rollback note is preserved as migration history.

## Dependencies

- Finalize TS stack choices to match Generador-de-FUA: Express, Sequelize, Zod, Jest, mysql2, PostgreSQL.

## Success Criteria

- [ ] TypeScript service matches current endpoint and validation behavior for covered flows.
- [ ] Existing invariant-heavy tests are ported and passing for types, engine, and API slices.
- [x] Production runtime is TypeScript; rollback guidance here is retained as historical migration context.
