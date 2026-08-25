# Runtime and deployment

The HTTP server is an always-available interactive runtime. The acquisition worker is a separate
process from the same backend build and may be continuous, scheduled, or on demand. Process scaling
does not change module ownership.

The source-only runtime exposes local health/readiness scaffolds and the Stage 2 shell/access code.
Gateway, Identity, provider, map, family navigation, and AI delivery states remain `not-integrated`
or `integration-gated` as routed in the workspace plan. The Place-owned physical PostGIS runtime is
declared source-only and is not yet connected to a deployed Web, backend, or worker process. A
source-only Node instrumentation hook can explicitly enable the Web OIDC composition, readiness-check
its bounded database pool before server readiness, schedule bounded cleanup, and close it on process
signals. Reviewed browser auth routes consume that runtime. Membership BFF routes use an independently
activated stateless backend client plus the auth session interface and fail closed if either required
runtime is absent. No active external route or provisioned Identity flow is implied.

One digest-pinned multi-stage Dockerfile produces separate `web-runtime` and `backend-runtime`
targets. The worker uses the backend image with a different command. Compose requires every host and
port from deployment configuration and activates the worker scaffold only in a verification profile.
The separate `compose.database.yml` remains in the same `place` Compose project, publishes no host
port, and requires an injected private data network, volume, administrator identity, and secret file.
