# Repository-wide tests

- `architecture/`: dependency and cross-repository boundary checks
- `contracts/`: published contract conformance
- `integration/`: real PostgreSQL/PostGIS and process-boundary checks from Stage 3
- `e2e/`: repository-owned Playwright browser flows

Playwright requires `PLACE_WEB_E2E_BASE_URL` with an explicit test-owned host and port. The repository
does not embed an environment address.

Live provider and map checks are opt-in and can never be the only proof of core behavior.
