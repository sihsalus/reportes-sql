# indicator-definition-validation Specification

## Purpose

Define request and stored-definition validation parity for the TypeScript indicator engine.

## Requirements

### Requirement: Canonical indicator definition validation

The system MUST accept the current indicator definition contract and reject invalid `tipo`, `periodo`, empty order concepts, negative bounds, and mixed mutually-exclusive filters.

#### Scenario: Valid canonical payload

- GIVEN a definition with supported `tipo`, `periodo`, and optional `poblacion` or `evento`
- WHEN the API validates it
- THEN the payload is accepted without persistence-time mutation

#### Scenario: Mutually-exclusive event filters

- GIVEN one `evento` containing both `diagnosticos` and `ordenes`
- WHEN validation runs
- THEN the request is rejected as invalid

### Requirement: Legacy normalization compatibility

The system MUST normalize legacy age keys, `eventos[]`, `encounter_type_uuids`, flat `diagnostico`, and flat `observaciones` into the canonical shape without changing semantic meaning.

#### Scenario: Flat legacy JSONB read

- GIVEN a stored definition using `eventos[]` and flat diagnosis or observation fields
- WHEN the system loads the definition
- THEN it exposes the canonical singular `evento` structure

#### Scenario: Mixed legacy and canonical age keys

- GIVEN a payload mixing `edad_*` keys with canonical `min_*` or `max_*` keys
- WHEN validation runs
- THEN the request is rejected to avoid ambiguous age semantics
