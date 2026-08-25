# Playwright E2E

The repository pins `@playwright/test` and its browser set. `PLACE_WEB_E2E_BASE_URL` supplies the
test-owned address. Desktop and mobile projects validate the responsive shell and own screenshot
baselines. Each user-visible milestone adds success, denial, loading, empty, error, and recovery paths
that it actually introduces.

The E2E launcher injects the contract-owned active family-navigation test fixture when the caller has
not supplied one. The fixture uses reserved example destinations and is test evidence only; it does
not declare a real family service or active integration.

Source-only OIDC denial E2E verifies that start, callback, and logout fail closed while the runtime
is inactive, that problems are safe and correlated, and that logout rejects GET. This does not claim
an active Identity or Gateway flow. When activated, Playwright must additionally cover the
public-path success flow, refresh/expiry, missing or
replayed transaction, unmapped membership, suspended membership, and sanitized provider failure
through the public Gateway path; browser assertions must prove that no token or internal endpoint is
observable.

Backend HTTP interface tests cover onboarding creation, idempotent existing-member resolution,
missing bearer evidence, unsupported browser authority fields, malformed JSON, stale consent, and
sanitized persistence failure. Browser Playwright onboarding remains gated until the Web BFF owns the
server-side call and a test composition can exercise the complete session path without exposing an
access token.
