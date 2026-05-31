# indicator-management-api Specification

## Purpose

Define HTTP behavior parity for indicator CRUD, versioning, and SQL preview endpoints.

## Requirements

### Requirement: CRUD and version lifecycle parity

The system MUST preserve endpoint shapes, pagination rules, UUID identifiers, soft-delete behavior, append-only version rows, and 404/409/422/502 outcomes for current indicator routes.

#### Scenario: Create indicator with first version

- GIVEN a valid create payload and valid OpenMRS locations
- WHEN the client posts to the create endpoint
- THEN the system persists one indicator and immutable version `1` atomically

#### Scenario: Update with unchanged definition

- GIVEN an update payload whose normalized definition matches the latest version
- WHEN the update endpoint runs
- THEN metadata is updated and no new version row is created

### Requirement: SQL preview parity

The system MUST expose SQL preview for the latest or requested version, return serialized parameters, and avoid executing calculation queries during preview.

#### Scenario: Preview latest version

- GIVEN an indicator with at least one version
- WHEN the preview endpoint is called without `version_id`
- THEN the response returns the latest version number, SQL, params, and computed period

#### Scenario: Preview unknown version

- GIVEN a `version_id` not belonging to the indicator
- WHEN preview is requested
- THEN the system returns not found for that indicator-version pair
