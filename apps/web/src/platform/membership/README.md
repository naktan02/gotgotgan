# Browser membership platform

This folder owns the browser-to-backend membership boundary. It is infrastructure for Place
membership screens, not a business-domain implementation.

- `membership-backend-client.ts` accepts one deployment-owned origin and bounded timeout, uses only
  fixed readiness/current-consent/onboarding paths, rejects redirects, and sends bearer evidence
  only for onboarding.
- `browser-membership-http.ts` owns strict browser request validation, server-session resolution,
  backend projection validation, hardened response headers, and sanitized correlated failures.
- `next-membership-lifecycle.ts` owns explicit fail-closed activation and one process-wide stateless
  backend client. It does not own or import the OIDC runtime.

Thin Next route files delegate here. They must not read tokens, construct backend URLs, decide roles,
or duplicate onboarding policy. The `access` module in the backend remains the authority for consent
matching and membership creation. The runtime is source-only and fails closed until the OIDC
and membership lifecycles plus backend composition are explicitly activated.
