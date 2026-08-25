# Place backend

This TypeScript package owns Place domain rules, adapters, incoming transports, and separate HTTP and
worker process composition. The HTTP process serves interactive product behavior. The acquisition
worker consumes durable jobs and may run continuously or on demand.

Current state: Stage 1 lifecycle scaffold only. No database, job claim, provider, browser profile, or
external integration exists.

Read `src/modules/README.md` before adding a capability. A module keeps domain, application, adapters,
transport, and tests together; root entrypoints only wire dependencies and own process lifecycle.

```powershell
npm run check --workspace @place/backend
```
