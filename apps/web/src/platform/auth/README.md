# Browser authentication platform

이 폴더는 사용자 Web의 앱별 조립 Adapter와 기존 import 호환 facade만 소유한다. confidential OIDC
Browser-BFF 구현은 React/Next.js에 의존하지 않는 `@place/browser-auth` workspace Module이 소유한다.
사용자 Web은 기존 `PLACE_*` 환경변수, `__Host-place_oidc_tx`, `__Host-place_session`,
`place.web.oidc.lifecycle`을 유지한다.

- `place-browser-auth-application.ts`는 사용자 Web 고유 storage namespace, 환경변수 prefix, cookie와
  global lifecycle key를 검증하고 shared Module을 한 번 조립한다.
- 기존 파일 이름은 다른 Web platform Module과 recovery 검증이 사용하는 안정된 import 경로를 위해
  유지하며 shared package Interface로 위임한다. Browser cookie에는 opaque identifier만 들어간다.
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
