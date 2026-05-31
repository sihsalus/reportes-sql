# indicator-query-engine Specification

## Purpose

Define SQL-generation parity for indicator execution against OpenMRS MySQL.

## Requirements

### Requirement: Parameterized SQL parity

The system MUST generate parameterized MySQL SQL only, preserve current count semantics for `conteo_atenciones` and `conteo_pacientes`, and MUST NOT interpolate user values into raw SQL.

#### Scenario: Basic patient-count query

- GIVEN a valid `conteo_pacientes` definition
- WHEN a preview or calculation builds SQL
- THEN the query counts distinct patients with named parameters

#### Scenario: Exclusive upper period bound

- GIVEN a user-visible inclusive `periodo_fin`
- WHEN SQL is built for encounter datetimes
- THEN the engine uses `< periodo_fin + 1 día` to preserve current results

### Requirement: Filter semantics parity

The system MUST preserve current location, diagnosis, order, age, sex, and `minimo_ocurrencias` semantics, including OR-within-diagnosis UUID lists and AND-across-order filters.

#### Scenario: Diagnosis filter with certainty

- GIVEN diagnosis UUIDs and `tipo_diagnostico`
- WHEN SQL is built
- THEN the query filters by the mapped certainty and diagnosis concepts

#### Scenario: Orders without resolved concept ids

- GIVEN `ordenes` without a resolved concept-id map
- WHEN SQL is built
- THEN the orders filter is omitted rather than replaced with incompatible SQL
