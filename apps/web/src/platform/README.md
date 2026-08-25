# Frontend platform

Auth, HTTP clients, maps, telemetry, theme, and external manifest adapters live here when integrated.
The `auth` folder currently owns source-only confidential OIDC BFF, provider, encrypted PostgreSQL,
and process-pool adapters. The `membership` folder owns the independent browser/backend bridge and
its stateless runtime. Membership may consume the narrow auth session interface; auth must not import
membership. Each folder README records its activation gates.
The `process-readiness` folder is the only platform owner allowed to aggregate the narrow auth and
membership readiness interfaces; it owns neither lifecycle.
