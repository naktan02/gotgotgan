# Playwright E2E

The repository pins `@playwright/test` and its browser set. `PLACE_WEB_E2E_BASE_URL` supplies the
test-owned address. Desktop and mobile projects validate the responsive shell and own screenshot
baselines. Each user-visible milestone adds success, denial, loading, empty, error, and recovery paths
that it actually introduces.

The E2E launcher injects the contract-owned active family-navigation test fixture when the caller has
not supplied one. The fixture uses reserved example destinations and is test evidence only; it does
not declare a real family service or active integration.

OIDC E2E is intentionally absent while callback routes, actual Next process composition, Identity,
and Gateway are not activated; durable storage/configuration alone does not claim a public flow. When activated,
Playwright must cover start, callback, refresh/expiry, logout, missing or
replayed transaction, unmapped membership, suspended membership, and sanitized provider failure
through the public Gateway path; browser assertions must prove that no token or internal endpoint is
observable.
