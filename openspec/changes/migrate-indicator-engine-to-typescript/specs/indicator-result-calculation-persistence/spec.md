# indicator-result-calculation-persistence Specification

## Purpose

Define parity for indicator execution, result persistence, and batch error handling.

## Requirements

### Requirement: Dual-database calculation flow

The system MUST read active indicator definitions from PostgreSQL, execute generated read-only SQL against OpenMRS MySQL, and persist computed results back to PostgreSQL using the selected indicator version and calculated period.

#### Scenario: Successful calculation

- GIVEN an active indicator with a latest version and valid dependencies
- WHEN batch calculation runs
- THEN a result row is stored with version id, period boundaries, numeric value, and calculation timestamp

#### Scenario: Indicator without versions

- GIVEN an active indicator with no versions
- WHEN batch calculation runs
- THEN the batch reports that indicator as an error and continues

### Requirement: Batch isolation and append-only persistence

The system MUST isolate per-indicator failures, keep successful calculations, and MUST NOT mutate historical version rows during result persistence.

#### Scenario: One indicator fails

- GIVEN a batch where one indicator raises an engine or dependency error
- WHEN calculation runs
- THEN other indicators still complete and the failure is returned in `errores`

#### Scenario: Empty query result

- GIVEN a generated SQL query that returns no rows
- WHEN persistence runs
- THEN no partial placeholder result is inserted
