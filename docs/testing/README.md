# Testing documentation

- `architecture.md`: dependency and forbidden-bucket checks.
- `contracts.md`: schema and compatibility checks.
- `integration.md`: real PostgreSQL/PostGIS and process tests.
- `e2e-playwright.md`: browser-owned critical journeys and screenshots.

Blocking tests are deterministic. The PostGIS suite covers empty-catalog discovery, repeat-local-hit,
selection and canonical-materialization replay, connected Import review, and encrypted capture expiry
cleanup. Playwright covers rapid typing cancellation, ambiguous branches, keyboard/mobile selection,
provider partial failure, full-search fallback, and Import cancel/resume/review retry. Live map/provider
checks require explicit opt-in and never supply shared personal credentials.
