# Browser authentication platform

This folder owns the confidential browser OIDC boundary for the Place Web process.

- `oidc-bff.ts` defines the small server-side login, callback, session-resolution, and logout
  interface. Browser cookies contain opaque identifiers only.
- `openid-client-provider.ts` adapts the external Identity OIDC protocol.
- `postgres-oidc-store.ts` persists one-time login transactions and browser sessions through a
  caller-owned PostgreSQL pool. Sensitive payloads are authenticated and encrypted before storage.
- `oidc-process-runtime.ts` owns one bounded pool, verifies database readiness, composes the BFF,
  and exposes explicit asynchronous close ownership.

No route handler imports this runtime yet. Identity provisioning, public callback routes, Gateway
routing, expiry cleanup, and deployment secret-file loading remain activation gates. Do not replace
the PostgreSQL adapter with process memory outside deterministic tests.
