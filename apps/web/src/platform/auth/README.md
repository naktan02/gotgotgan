# Browser authentication platform

This folder owns the confidential browser OIDC boundary for the Place Web process.

- `oidc-bff.ts` defines the small server-side login, callback, session-resolution, and logout
  interface. Browser cookies contain opaque identifiers only.
- `openid-client-provider.ts` adapts the external Identity OIDC protocol.
- `postgres-oidc-store.ts` persists one-time login transactions and browser sessions through a
  caller-owned PostgreSQL pool. Sensitive payloads are authenticated and encrypted before storage;
  expired rows are deleted in configured batches of at most 1,000 per table.
- `oidc-process-runtime.ts` owns one bounded pool, verifies database readiness, composes the BFF,
  and exposes bounded cleanup plus explicit asynchronous close ownership.
- `oidc-runtime-config.ts` loads database credentials, the confidential client secret, and the
  rotatable encryption keyring only from deployment-referenced one-line secret files. It rejects
  insecure issuers, malformed 32-byte base64url keys, duplicate key IDs, and unbounded cleanup.

No route handler imports this runtime yet. Identity provisioning, public callback routes, Gateway
routing, and actual Next process installation remain activation gates. Do not replace the PostgreSQL
adapter with process memory outside deterministic tests.
