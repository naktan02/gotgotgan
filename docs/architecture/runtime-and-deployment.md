# Runtime and deployment

The HTTP server is an always-available interactive runtime. The acquisition worker is a separate
process from the same backend build and may be continuous, scheduled, or on demand. Process scaling
does not change module ownership.

The source-only runtime exposes local health/readiness scaffolds and the Stage 2 shell/access code.
Gateway, Identity, provider, map, family navigation, and AI delivery states remain `not-integrated`
or `integration-gated` as routed in the workspace plan. The Place-owned physical PostGIS runtime is
declared source-only and is not yet connected to a deployed Web, backend, or worker process. A
source-only Web OIDC composition can create, readiness-check, and close its own bounded database pool;
no route imports or instantiates it yet.

One digest-pinned multi-stage Dockerfile produces separate `web-runtime` and `backend-runtime`
targets. The worker uses the backend image with a different command. Compose requires every host and
port from deployment configuration and activates the worker scaffold only in a verification profile.
The separate `compose.database.yml` remains in the same `place` Compose project, publishes no host
port, and requires an injected private data network, volume, administrator identity, and secret file.
