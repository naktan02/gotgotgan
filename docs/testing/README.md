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

Fulfillment PostGIS는 동일 Provider Place ID의 여러 회원 intent가 job 하나와 상세 호출 하나를
공유하고, 이후 Canonical cache hit이 Provider 호출 없이 Library에 저장되는지 검증한다. Import
Playwright는 `enriching` 상태에서 검토 control이 노출되지 않다가 `needs-review` 전환 후에만 활성화되는
desktop/mobile 흐름도 검증한다.
