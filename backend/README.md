# Place backend

This TypeScript package owns Place domain rules, adapters, incoming transports, and separate HTTP and
worker process composition. The HTTP process serves interactive product behavior. The acquisition
worker consumes durable jobs and may run continuously or on demand.

Current state: Stage 4 source implementation complete; Stage 2 integration remains in progress. The `access` module owns verified-principal mapping,
Place roles and tiers, authorization, last-owner protection, and audit-safe decisions. `GET /v1/me`
is registered by the source-only production composition with the other access transports. That
composition reads a protected runtime URL and membership-policy file, creates one bounded Pool,
installs the OIDC resource-server verifier, reports database-backed readiness, and owns close. The
explicit `source-only` process mode still starts only lifecycle routes for standalone verification.
The platform database preparation command provisions
Place-owned roles, installs PostGIS as the administrator, and runs versioned migrations as
`place_owner`; it is not application startup and supplies no runtime connection to HTTP or Worker.
The access module has a real PostgreSQL adapter for membership, bootstrap, authorization audit, and
atomic authority-role changes. Its optional source-only onboarding transport verifies bearer
evidence, rejects browser authority fields, and delegates current-consent creation to the access use
case. The same optional route bundle publishes current consent discovery and an independently
optional authority-role administration transport. The production composition supplies their
verifier, deployment-owned policy, ID source, and process-owned Pool only when
`PLACE_HTTP_RUNTIME_MODE=production` is explicitly selected with complete configuration. No deployed
application database connection, job claim, provider, browser profile, or external integration
exists.

The `ingestion` module now records immutable observations, normalized candidates, and resolution
decisions through one append interface. The `places` module independently applies idempotent
canonical create/link/merge/split/retire commands and resolves redirects/provider identities. Their
PostgreSQL adapters and migrations are source-only and have real PostGIS integration evidence; no
HTTP or Worker transport is registered for them yet.

`library`, `visits`, `writing` 모듈은 독립적인 application interface, 최소 권한 PostgreSQL
adapter, 모듈 소유 HTTP transport를 제공한다. production composition은 browser actor field가
아니라 Access에서 파생한 공통 authorization 결과를 주입한다. public Collection과 Writing
조회는 별도의 허용 목록 projection이며 Visit, Personal Rating 이력, Writing revision은
비공개로 유지한다.

Read `src/modules/README.md` before adding a capability. A module keeps domain, application, adapters,
transport, and tests together; root entrypoints only wire dependencies and own process lifecycle.

```powershell
npm run check --workspace @place/backend
npm run database:prepare --workspace @place/backend
```
