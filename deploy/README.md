# Deployment declarations

`application-runtime.json` is the source-only machine-readable process and exposure contract. Web is
the only future Gateway-facing process; Backend and Worker stay internal. Browser-to-Backend and
cross-project database connections are forbidden.

`compose.yml` is the port-free product base and keeps all Place processes under one product-owned
Compose project:

- `web`: standalone Next.js runtime;
- `backend`: Fastify HTTP runtime with explicit `source-only` or `production` mode; and
- `worker-check`: opt-in verification profile for the separately runnable worker artifact.

`compose.local.yml` adds explicit standalone host ports while Web integrations and Backend access
transports remain source-only by default. `compose.production.yml` selects Backend production
composition, activates Web OIDC and membership runtimes, mounts the database/OIDC secret-file roles
plus the non-secret membership policy, and joins the injected Place data network. It publishes no
Backend host port. All addresses, files, pool bounds, timeouts, issuer/audience/scopes, and policy are
required deployment inputs.

The Web OIDC configuration consumes `PLACE_DATABASE_URL_FILE`,
`PLACE_OIDC_CLIENT_SECRET_FILE`, and `PLACE_OIDC_ENCRYPTION_KEYRING_FILE`. A deployment secret sink
mounts those files read-only; direct credential environment values are unsupported. Non-secret
issuer, client ID, callback, scope, TTL, pool, and cleanup settings remain injected and fail closed.
Production overlay sets `PLACE_OIDC_RUNTIME_ENABLED=true` and
`PLACE_MEMBERSHIP_RUNTIME_ENABLED=true`; false or missing keeps each source-only integration
disconnected, while any other value fails startup.

The Backend base defaults to explicit `PLACE_HTTP_RUNTIME_MODE=source-only` and registers lifecycle
routes only. Production overlay sets `production`; startup then requires the protected runtime URL,
bounded Pool values, strict `place-membership-policy.v1` file, and OIDC resource-server settings. An
initial database failure prevents startup and later failure makes both Backend and Web readiness
unhealthy.

`identity/oidc-client.json` is the Place-owned, unprovisioned Identity input. The provisioner expands
`PLACE_PUBLIC_ORIGIN`, delivers the generated client ID/secret through the approved secret sink, and
runs only after callback routes, shared session storage, Gateway routing, health validation, and
rollback are ready. The manifest contains no credential and does not activate Identity.

`database-runtime.json` and `compose.database.yml` declare the source-only Place-owned physical
PostGIS runtime. The database Compose file remains under the `place` project, publishes no host port,
and requires deployment-injected administrator, migration, runtime, volume, and data-network inputs.
Production application composition is an activation input only; environment promotion still waits
for backup/restore, key recovery, immutable artifact, Identity/Gateway, and rollback gates.

Validate overlay expansion without starting processes. Supply only test-owned placeholder files and
reserved-example endpoints:

```powershell
docker compose -f deploy/compose.yml -f deploy/compose.local.yml config
docker compose -f deploy/compose.yml -f deploy/compose.production.yml config
docker compose -f deploy/compose.database.yml config
```

The image base is digest-pinned. With Docker running, validate targets from the repository root:

```powershell
docker build --target web-runtime --tag place-web-source .
docker build --target backend-runtime --tag place-backend-source .
```
