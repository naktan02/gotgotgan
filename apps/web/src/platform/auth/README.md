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
- `next-oidc-lifecycle.ts` is the explicit Node process owner selected by Next instrumentation. It
  defaults to disabled, rejects ambiguous activation, installs one runtime, schedules non-overlapping
  bounded cleanup, and owns signal-triggered close.

`src/instrumentation.ts` now installs this lifecycle before the Node server becomes ready, but no
route handler consumes it yet. Identity provisioning, public callback routes, and Gateway routing
remain activation gates. Do not replace the PostgreSQL adapter with process memory outside
deterministic tests.
