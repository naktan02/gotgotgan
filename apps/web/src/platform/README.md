# Frontend platform

Auth, HTTP clients, maps, telemetry, theme, and external manifest adapters live here when integrated.
The `auth` folder currently owns source-only confidential OIDC BFF, provider, encrypted PostgreSQL,
and process-pool adapters. The `membership` folder owns the independent browser/backend bridge and
its stateless runtime. Membership may consume the narrow auth session interface; auth must not import
membership. Each folder README records its activation gates.
