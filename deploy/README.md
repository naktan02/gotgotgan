# Deployment declarations

`compose.yml` keeps all Place processes under one product-owned Compose project without activating a
platform deployment:

- `web`: standalone Next.js runtime;
- `backend`: always-on Fastify HTTP runtime; and
- `worker-check`: opt-in verification profile for the separately runnable worker artifact.

All host and port values are required environment inputs. There is no active database connection,
provider, Identity, Gateway, map, or AI connection. Declarations reference secrets and addresses by
deployment-owned names, publish no browser credentials, and follow workspace onboarding gates before
Gateway exposure.

The source-only Web OIDC configuration consumes `PLACE_DATABASE_URL_FILE`,
`PLACE_OIDC_CLIENT_SECRET_FILE`, and `PLACE_OIDC_ENCRYPTION_KEYRING_FILE`. A deployment secret sink
must mount those files read-only; direct credential environment values are not supported. Non-secret
issuer, client ID, callback, scope, TTL, pool, and cleanup settings remain injected and fail closed.
`PLACE_OIDC_RUNTIME_ENABLED=true` is required to install the runtime; false or missing keeps the
source-only Web disconnected, while any other value fails startup. Activation also requires a bounded
`PLACE_OIDC_CLEANUP_INTERVAL_SECONDS` value.

`identity/oidc-client.json` is the Place-owned, unprovisioned Identity input. The provisioner must
expand `PLACE_PUBLIC_ORIGIN`, deliver the generated client ID/secret through the approved secret
sink, and run only after callback routes, shared session storage, Gateway routing, health validation,
and rollback are ready. The manifest itself contains no credential and does not activate Identity.

`database-runtime.json` and `compose.database.yml` declare the source-only Place-owned physical
PostGIS fallback selected by ADR 0004. The database Compose file remains under the `place` project,
publishes no host port, and requires deployment-injected `PLACE_POSTGRES_ADMIN_USER`,
`PLACE_POSTGRES_ADMIN_PASSWORD_FILE`, `PLACE_POSTGRES_ADMIN_DATABASE_URL_FILE`, distinct
migration/runtime password and database-URL secret files declared in `database-runtime.json`,
`PLACE_POSTGRES_DATA_VOLUME`, and `PLACE_DATA_NETWORK`. It
must not be combined with application Compose until migration/runtime role provisioning, schema,
least-privilege, spatial-index, backup/restore, and rollback gates pass.

Validate declaration expansion without starting it:

```powershell
$env:PLACE_POSTGRES_ADMIN_USER='validation-only'
$env:PLACE_POSTGRES_ADMIN_PASSWORD_FILE='<protected-file-path>'
$env:PLACE_POSTGRES_DATA_VOLUME='validation-volume'
$env:PLACE_DATA_NETWORK='validation-network'
docker compose -f deploy/compose.database.yml config
```

The image base is digest-pinned to the Node 22 image already proved by Game Studio. With Docker
running, validate targets from the repository root:

```powershell
docker build --target web-runtime --tag place-web-stage2 .
docker build --target backend-runtime --tag place-backend-stage2 .
```
