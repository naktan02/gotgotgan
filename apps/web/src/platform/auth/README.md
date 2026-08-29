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
  defaults to disabled, rejects ambiguous activation, retries transient database startup inside a
  bounded deployment policy, installs one runtime, schedules non-overlapping bounded cleanup, shares
  it safely across Next server bundles, and owns signal-triggered close.
- `browser-auth-http.ts` is the reviewed HTTP boundary. It delegates to the BFF, applies no-store and
  browser hardening headers, correlates safe problems, and sanitizes unexpected provider failures.

`src/instrumentation.ts` installs this lifecycle before the Node server becomes ready. Thin Next
handlers expose source-only start, callback, and POST-only logout operations and fail closed while
the runtime is disabled. Identity provisioning and Gateway routing remain activation gates. Do not
replace the PostgreSQL adapter with process memory outside deterministic tests.
