# Testing documentation

- `architecture.md`: dependency and forbidden-bucket checks.
- `contracts.md`: schema and compatibility checks.
- `integration.md`: real PostgreSQL/PostGIS and process tests.
- `e2e-playwright.md`: browser-owned critical journeys and screenshots.

Blocking tests are deterministic. The PostGIS suite covers empty-catalog discovery, repeat-local-hit,
selection and canonical-materialization replay, and bounded expiry cleanup. Playwright covers rapid
typing cancellation, ambiguous branches, keyboard/mobile selection, provider partial failure, and
the full-search fallback. Live map/provider checks require explicit opt-in and never supply shared
personal credentials.
