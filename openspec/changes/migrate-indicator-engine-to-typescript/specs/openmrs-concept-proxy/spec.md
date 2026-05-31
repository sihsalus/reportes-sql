# openmrs-concept-proxy Specification

## Purpose

Define parity for OpenMRS-backed concept and location lookup endpoints used by the indicator engine.

## Requirements

### Requirement: Proxy and parsing parity

The system MUST preserve current OpenMRS proxy routes, authentication-backed forwarding, diagnosis CIE-10 extraction, location resolution, and response shaping for concept searches.

#### Scenario: Diagnosis search with code extraction

- GIVEN an OpenMRS diagnosis concept whose names include a CIE-10-like code and a label
- WHEN diagnosis search is requested
- THEN the response returns `uuid`, `nombre`, and `codigo`

#### Scenario: Diagnosis search without code label

- GIVEN an OpenMRS concept with no CIE-10-like code in `names`
- WHEN diagnosis search is requested
- THEN the response omits `codigo` and preserves the display name fallback

### Requirement: Availability and validation errors

The system MUST preserve current client-visible validation errors for empty search input and 502 proxy failures for upstream connectivity or HTTP errors.

#### Scenario: Empty diagnosis query

- GIVEN an empty or whitespace-only diagnosis search string
- WHEN the request is validated
- THEN the system rejects it before contacting OpenMRS

#### Scenario: OpenMRS unavailable

- GIVEN an upstream connection or non-2xx OpenMRS failure
- WHEN a proxy or validation endpoint runs
- THEN the system returns a bad-gateway error without exposing internal stack traces
