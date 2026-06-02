# Design: Migrate Indicator Engine to TypeScript

Historical design retained for migration context. The repository now runs on the TypeScript design described below.

## Technical Approach

Incremental module replacement. Build the TypeScript foundation (config, DB clients, Zod schemas), then port the SQL builder (highest-risk slice), then models/Sequelize, then routers/Express, then container cutover. The migration has since completed and the Python source is no longer present.

## Architecture Decisions

| Decision | Options | Tradeoff | Choice |
|---|---|---|---|
| HTTP framework | Express 5 vs Fastify | Fastify is faster; Express 5 matches Generador-de-FUA exactly and has the middleware ecosystem we need | Express 5 |
| MySQL access | Sequelize vs mysql2 direct | Sequelize ORM adds complexity for read-only raw SQL; mysql2 direct is simpler and matches current `exec_driver_sql` pattern | mysql2 pool direct |
| Validation | Zod vs class-validator | Zod is the Generador-de-FUA standard and has better preprocess/transform for legacy JSONB normalization | Zod 3 |
| TS ORM | Sequelize vs TypeORM | Both support dual-DB; Sequelize is the established reference choice | Sequelize 6 for PostgreSQL |
| Test framework | Jest vs Vitest | Jest 30 + ts-jest is the reference stack | Jest 30 |

## Data Flow

```
Client → Express Router → Zod Validation → Sequelize (PG)
                              ↓
                        SQL Builder (TS)
                              ↓
                        mysql2 (OpenMRS read)
                              ↓
                        Sequelize (PG write)
```

## File Changes

| File | Action | Description |
|---|---|---|
| `src/config/index.ts` | Create | Env vars via `dotenv` + typed config object (replaces Pydantic Settings) |
| `src/database/postgres.ts` | Create | Sequelize PG instance (async) |
| `src/database/mysql.ts` | Create | mysql2 pool for OpenMRS (sync read-only) |
| `src/types/definicion.ts` | Create | Zod schemas with `.preprocess()` for legacy normalization |
| `src/engine/interpreter.ts` | Create | SQL builder — translate Zod-validated defs to parameterized MySQL |
| `src/engine/executor.ts` | Create | Runs mysql2 queries + persists Sequelize Resultado rows |
| `src/engine/periodo.ts` | Create | Pure date logic (identical algorithm) |
| `src/models/indicador.ts` | Create | Sequelize models: Indicador, IndicadorVersion, IndicadorResultado |
| `src/routers/*.ts` | Create | Express routers with asyncHandler wrapper |
| `src/main.ts` | Create | Express app bootstrap, CORS, error middleware |
| `tests/**/*.test.ts` | Create | Jest + supertest parity suite |
| `Dockerfile` | Modify | Multi-stage Node build, remove Python |
| `docker-compose.yml` | Modify | Node service, same env vars |
| Legacy Python source tree | Delete | Completed after TS parity and cutover |

## Interfaces / Contracts

```typescript
// Zod canonical definition (simplified)
const FiltrosPoblacionSchema = z.object({
  min_dias: z.number().int().min(0).optional(),
  // ... (all 6 fields)
}).superRefine((data, ctx) => {
  // same-group exclusivity
});

// MySQL execution contract
interface OpenMRSQueryResult {
  valor: number;
}
// mysql2 uses :name placeholders, not %(name)s
```

## Testing Strategy

| Layer | What | Approach |
|---|---|---|
| Unit | Zod validation, SQL builder strings, periodo math | Jest with direct module imports |
| Integration | DB round-trips, router mounting, error middleware | supertest against Express app with mocked DB |
| E2E | Batch calculation flow | Docker compose with test DBs, run full `calcular-ahora` |

## Migration / Rollout

1. **Slice 0**: Scaffold `package.json`, `tsconfig.json`, Jest config, `src/` directory.
2. **Slice 1**: Port `types/definicion.py` → `src/types/definicion.ts` (Zod + preprocess). Run Jest validation parity tests.
3. **Slice 2**: Port `engine/interpreter.py` → `src/engine/interpreter.ts`. Run Jest SQL-generation parity tests.
4. **Slice 3**: Set up Sequelize models + mysql2 pool. Port executor.
5. **Slice 4**: Port routers one-by-one (conceptos → indicadores → resultados).
6. **Slice 5**: `src/main.ts` + Docker cutover.
7. **Gate**: All migration-critical scenarios have passing Jest equivalents. Legacy Python artifacts can then be removed.

Rollback during migration: revert Dockerfile to the legacy runtime image; PostgreSQL schema/data unchanged.

## Open Questions

- [ ] Should `Numeric(18,6)` map to `Sequelize.DECIMAL` or `Sequelize.FLOAT`? Need to verify JS `number` precision for financial indicators.
- [x] `src/` is the chosen project structure in the current TypeScript codebase.
