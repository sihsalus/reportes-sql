# Verification Report: migrate-indicator-engine-to-typescript

Historical migration report, updated to match the current repository state. The codebase is now TypeScript-only; Python sources mentioned here are legacy context.

## Change
migrate-indicator-engine-to-typescript

## Mode
Standard (Strict TDD inactive)

## Date
2026-05-30

## Completeness Table

| Phase | Task | Status |
|---|---|---|
| 1.1 | package.json, tsconfig, Jest config | ✅ Complete |
| 1.2 | src/config/index.ts | ✅ Complete |
| 1.3 | src/database/postgres.ts | ✅ Complete |
| 1.4 | src/database/mysql.ts | ✅ Complete |
| 1.5 | src/types/definicion.ts | ✅ Complete |
| 1.6 | Jest parity tests for validation | ✅ Complete |
| 2.1 | src/engine/periodo.ts | ✅ Complete |
| 2.2 | src/engine/interpreter.ts | ✅ Complete |
| 2.3 | src/engine/executor.ts | ✅ Complete |
| 2.4 | Jest parity tests for SQL, params, periodo | ✅ Complete |
| 3.1 | src/models/indicador.ts | ✅ Complete |
| 3.2 | src/routers/conceptos.ts | ✅ Complete |
| 3.3 | src/routers/indicadores.ts | ✅ Complete |
| 3.4 | src/routers/resultados.ts | ✅ Complete |
| 3.5 | Jest integration tests for routers | ✅ Complete |
| 4.1 | src/main.ts | ✅ Complete |
| 4.2 | Dockerfile multi-stage Node | ✅ Complete |
| 4.3 | docker-compose.yml Node service | ✅ Complete |
| 4.4 | TS E2E smoke suite in Docker | ❌ Incomplete |
| 4.5 | Remove legacy Python artifacts | ✅ Complete |

## Build / Tests / Coverage Evidence

| Command | Result |
|---|---|
| `pnpm build` | ⚠️ Historical PASS on 2026-05-30; current status must be revalidated separately |
| `pnpm test -- --coverage` | ✅ PASS (5 suites, 146 tests, 0 failures) |
| Coverage (all files) | 81.62% stmts, 66.77% branch, 94.66% funcs, 82.31% lines |

**Coverage breakdown:**
| File | % Stmts | % Branch | % Funcs | % Lines |
|---|---|---|---|---|
| engine/interpreter.ts | 86.95 | 77.41 | 100 | 87.81 |
| engine/periodo.ts | 38.88 | 14.28 | 100 | 38.88 |
| routers/conceptos.ts | 85.80 | 54.23 | 100 | 86.09 |
| routers/indicadores.ts | 71.76 | 50.76 | 81.81 | 72.18 |
| routers/resultados.ts | 71.01 | 48.14 | 71.42 | 71.64 |
| types/definicion.ts | 95.23 | 92.30 | 100 | 97.97 |

## Spec Compliance Matrix

| Spec Domain | Scenario | Covering Test | Result |
|---|---|---|---|
| indicator-definition-validation | Valid canonical payload | `test_types_definicion.test.ts` — minimal valid, full with diagnosticos/ordenes | ✅ COMPLIANT |
| indicator-definition-validation | Mutually-exclusive event filters | `test_types_definicion.test.ts` — both set fails, both inside definicion fails | ✅ COMPLIANT |
| indicator-definition-validation | Flat legacy JSONB read | `test_types_definicion.test.ts` — flat diagnostico/observaciones, eventos[], idempotent double parse | ✅ COMPLIANT |
| indicator-definition-validation | Mixed legacy and canonical age keys | `test_types_definicion.test.ts` — mixed legacy and canonical rejected | ✅ COMPLIANT |
| indicator-query-engine | Basic patient-count query | `test_engine_interpreter.test.ts` — conteo_pacientes returns COUNT DISTINCT | ✅ COMPLIANT |
| indicator-query-engine | Exclusive upper period bound | `test_engine_interpreter.test.ts` — `e.encounter_datetime < :fin_excl`, fin_excl is +1 day | ✅ COMPLIANT |
| indicator-query-engine | Diagnosis filter with certainty | `test_engine_interpreter.test.ts` — definitivo/presuntivo certainty mapping | ✅ COMPLIANT |
| indicator-query-engine | Orders without resolved concept ids | `test_engine_interpreter.test.ts` — no concept_map omits orders filter | ✅ COMPLIANT |
| indicator-management-api | Create indicator with first version | `test_routers_indicadores.test.ts` — creates indicator with version 1 and returns 201 | ✅ COMPLIANT |
| indicator-management-api | Update with unchanged definition | `test_routers_indicadores.test.ts` — skips version when definicion unchanged | ✅ COMPLIANT |
| indicator-management-api | Preview latest version | `test_routers_indicadores.test.ts` — returns SQL preview for latest version | ✅ COMPLIANT |
| indicator-management-api | Preview unknown version | `test_routers_indicadores.test.ts` — returns 404 when version not found | ✅ COMPLIANT |
| indicator-result-calculation-persistence | Successful calculation | `test_routers_resultados.test.ts` — calculates active indicators and returns summary | ✅ COMPLIANT |
| indicator-result-calculation-persistence | Indicator without versions | `test_routers_resultados.test.ts` — reports error for indicator without versions | ✅ COMPLIANT |
| indicator-result-calculation-persistence | One indicator fails | `test_routers_resultados.test.ts` — isolates failures, one fails others succeed | ✅ COMPLIANT |
| indicator-result-calculation-persistence | Empty query result | `src/engine/executor.ts` lines 59-64 guard with `if (resultados.length > 0)`, but no unit/integration test directly asserts `executeAndPersist` skips `bulkCreate` when MySQL returns zero rows | ⚠️ UNTESTED |
| openmrs-concept-proxy | Diagnosis search with code extraction | `test_routers_conceptos.test.ts` — extracts CIE-10 code and nombre from names | ✅ COMPLIANT |
| openmrs-concept-proxy | Diagnosis search without code label | `test_routers_conceptos.test.ts` — omits codigo when no CIE-10 pattern found | ✅ COMPLIANT |
| openmrs-concept-proxy | Empty diagnosis query | `test_routers_conceptos.test.ts` — returns 400 when q is empty (rejected before OpenMRS) | ✅ COMPLIANT |
| openmrs-concept-proxy | OpenMRS unavailable | `test_routers_conceptos.test.ts` — returns 502 when OpenMRS is unavailable / on HTTP error | ✅ COMPLIANT |

**Compliance summary**: 19/20 scenarios compliant (1 UNTESTED)

## Correctness (Static Evidence)

| Requirement | Status | Notes |
|---|---|---|
| Zod schemas parity | ✅ Implemented | `src/types/definicion.ts` preserves the legacy normalization behavior needed for existing data |
| SQL builder parity | ✅ Implemented | `src/engine/interpreter.ts` uses `:name` placeholders for mysql2; no raw interpolation |
| Executor empty-result guard | ✅ Implemented | `src/engine/executor.ts` skips `bulkCreate` when `resultados.length === 0` |
| Router error shapes | ✅ Implemented | 422 `{detail: {field, message}}`, 404/502 `{detail: string}` preserve the legacy API envelope |
| OpenMRS location validation | ✅ Implemented | `src/validators/openmrs.ts` validates location UUIDs and resolves concept maps via mysql2 |

## Coherence (Design)

| Decision | Design Choice | Implementation | Deviation |
|---|---|---|---|
| HTTP framework | Express 5 | `express: ^5.1.0` in package.json | None |
| MySQL access | mysql2 direct | `mysql2/promise` pool in `src/database/mysql.ts` | None |
| Validation | Zod 3 | `zod: ^3.23.8` in package.json | None |
| TS ORM | Sequelize 6 | `sequelize: ^6.37.3` in package.json | None |
| Test framework | Jest 30 | `jest: ^29.7.0` in package.json | ⚠️ Using Jest 29, not 30 (latest stable) |
| `Numeric(18,6)` | `DECIMAL(18,6)` | `DataTypes.DECIMAL(18,6)` in `src/models/indicador.ts` | None |
| Folder naming | `src/` vs `app/` | Uses `src/` | None |

## Issues Found

### CRITICAL
- None in the 2026-05-30 verification snapshot; current build status was not revalidated in this document revision.

### WARNING
1. **Task 4.4 incomplete** — TS E2E smoke coverage in Docker has not been run in this environment. Blocked by absence of Docker daemon / PostgreSQL + OpenMRS containers here.
2. **Jest version mismatch** — Design specifies Jest 30; package.json uses Jest 29. Minor toolchain drift with no known functional impact.
3. **Coverage blind spot on engine/periodo.ts** — Only 38.88% statement coverage; period math edge cases (e.g. `anual_actual`, `trimestre_actual`) are not directly exercised.
4. **Spec scenario UNTESTED** — `indicator-result-calculation-persistence > Empty query result` is implemented in `executor.ts` but lacks a direct covering test.

### SUGGESTION
1. Add a unit test for `executeAndPersist` that mocks mysql2 returning zero rows and asserts `bulkCreate` is not called.
2. Add unit tests for `periodo.ts` to close the coverage gap on `anual_actual` and `trimestre_actual` branches.
3. Upgrade Jest to v30 when available/stable to align with design decision.
4. Run a Docker-compose E2E smoke test against the TS service to validate the full request/response cycle in the current stack.
5. Consider adding a `.env.example` file if the project needs a shareable environment template for onboarding.

## Final Verdict

**PASS WITH WARNINGS (historical snapshot)**

The TypeScript foundation, engine parity (Phases 1 and 2), and router implementation with integration tests (Phase 3) were verified in the 2026-05-30 migration snapshot with 146 passing tests. Spec compliance is 19/20 scenarios in that snapshot; the remaining scenario (`Empty query result`) is implemented in source but lacks a direct test. Infra cutover code is in place, while Docker-level E2E smoke verification (4.4) remains open. Legacy Python artifacts have already been removed from the repository. Recommended next step is to revalidate `pnpm build` and unblock Task 4.4 in an environment with Docker and real databases.
