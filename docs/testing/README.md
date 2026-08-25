# Testing documentation

- `architecture.md`: dependency and forbidden-bucket checks.
- `contracts.md`: schema and compatibility checks.
- `integration.md`: real PostgreSQL/PostGIS and process tests.
- `e2e-playwright.md`: browser-owned critical journeys and screenshots.

Blocking tests are deterministic. Live map/provider checks require explicit opt-in and never supply
shared personal credentials.
