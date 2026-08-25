# Runtime and deployment

The HTTP server is an always-available interactive runtime. The acquisition worker is a separate
process from the same backend build and may be continuous, scheduled, or on demand. Process scaling
does not change module ownership.

The source-only runtime exposes local health/readiness scaffolds and the Stage 2 shell/access code.
Gateway, Identity, provider, map, family navigation, and AI delivery states remain `not-integrated`
or `integration-gated` as routed in the workspace plan. The Place-owned physical PostGIS runtime is
declared source-only and is not yet connected to a deployed Web, backend, or worker environment. A
source-only backend production composition now creates one bounded Pool, installs the access
PostgreSQL adapter and OIDC verifier, registers all access transports, and owns readiness/close. It
is selected only by explicit process mode with complete protected configuration. A source-only Node
instrumentation hook can explicitly enable the Web OIDC composition, readiness-check
its bounded database pool before server readiness, schedule bounded cleanup, and close it on process
signals. Reviewed browser auth routes consume that runtime. Membership BFF routes use an independently
activated stateless backend client plus the auth session interface and fail closed if either required
runtime is absent. No active external route or provisioned Identity flow is implied.

`deploy/application-runtime.json` fixes Web as the only future Gateway-facing process. Backend and
Worker remain internal; browsers cannot select or call Backend directly. The Compose base publishes
no host ports, `compose.local.yml` adds explicit standalone ports, and `compose.production.yml`
mounts symbolic secret/config roles and the Place data network without embedding an address or
credential.

One digest-pinned multi-stage Dockerfile produces separate `web-runtime` and `backend-runtime`
targets. The worker uses the backend image with a different command. Local Compose alone owns those
build targets. The port-free base and production overlay consume injected immutable image
coordinates, while the deployment planner binds Web and Backend to one source revision and preserves
the database during application-only rollback. Compose requires every host and port from deployment
configuration and activates the worker scaffold only in a verification profile.
The producer release declaration binds those two targets and four process roles to one
`place@<commit>` revision while retaining `source-only` deployment state. The manual release
workflow owns GHCR publication, BuildKit SBOM/provenance extraction, published-platform-digest
smoke, and the checksum-bound release record. It has no promotion or environment authority.
Existing commit tags are immutable checkpoints: a retry verifies any existing image before building
only the missing image, then regenerates evidence for the complete pair.
The separate `compose.database.yml` remains in the same `place` Compose project, publishes no host
port, and requires an injected private data network, volume, administrator identity, and secret file.
