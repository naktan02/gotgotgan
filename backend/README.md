# Place backend

This TypeScript package owns Place domain rules, adapters, incoming transports, and separate HTTP and
worker process composition. The HTTP process serves interactive product behavior. The acquisition
worker consumes durable jobs and may run continuously or on demand.

Current state: Stage 2 source implementation. The `access` module owns verified-principal mapping,
Place roles and tiers, authorization, last-owner protection, and audit-safe decisions. `GET /v1/me`
is registered only when its verifier, membership directory, and audit sink are injected; the
production composition does not connect it yet. No database connection, job claim, provider, browser profile,
or external integration exists.

Read `src/modules/README.md` before adding a capability. A module keeps domain, application, adapters,
transport, and tests together; root entrypoints only wire dependencies and own process lifecycle.

```powershell
npm run check --workspace @place/backend
```
