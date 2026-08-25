# Place backend

This TypeScript package owns Place domain rules, adapters, incoming transports, and separate HTTP and
worker process composition. The HTTP process serves interactive product behavior. The acquisition
worker consumes durable jobs and may run continuously or on demand.

Current state: Stages 2 and 3 source implementation. The `access` module owns verified-principal mapping,
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

Read `src/modules/README.md` before adding a capability. A module keeps domain, application, adapters,
transport, and tests together; root entrypoints only wire dependencies and own process lifecycle.

```powershell
npm run check --workspace @place/backend
npm run database:prepare --workspace @place/backend
```
