# Deployment declarations

`application-runtime.json` is the source-only machine-readable process and exposure contract. Web is
the only future Gateway-facing process; Backend and Worker stay internal. Browser-to-Backend and
cross-project database connections are forbidden.

`compose.yml` is the port-free product base. It accepts only deployment-injected Web and Backend
image references and keeps all Place processes under one product-owned Compose project:

- `web`: standalone Next.js runtime;
- `backend`: Fastify HTTP runtime with explicit `source-only` or `production` mode; and
- `worker-check`: opt-in verification profile for the separately runnable worker artifact.

`compose.local.yml` alone adds Docker build targets and explicit standalone host ports while Web
integrations and Backend access transports remain source-only by default. Local validation still
supplies explicit image tags for the resulting builds. `compose.production.yml` selects Backend
production composition, activates Web OIDC and membership runtimes, mounts the database/OIDC secret-file roles
plus the non-secret membership policy, and joins the injected Place data network. It publishes no
Backend host port. All addresses, files, pool bounds, timeouts, issuer/audience/scopes, and policy are
required deployment inputs.

Production image inputs must be immutable coordinates in the form
`<registry>/<repository>@sha256:<64 lowercase hex>`. Run `npm run plan:deployment` before an
activation or rollback. It requires `PLACE_DEPLOYMENT_OPERATION`, `PLACE_RELEASE_REVISION`,
`PLACE_WEB_IMAGE`, and `PLACE_BACKEND_IMAGE`. Rollback additionally requires the deployed release
revision and images through `PLACE_DEPLOYED_RELEASE_REVISION`, `PLACE_DEPLOYED_WEB_IMAGE`, and
`PLACE_DEPLOYED_BACKEND_IMAGE`. The sanitized plan binds the two images as one Place application
unit and always preserves the database; migration rollback is application-only. This planner proves
selection and rollback intent, not publication provenance. A release still needs independently
verified digest, SBOM, provenance, and successful published-digest smoke evidence.

`release-source.v1.json` is the producer declaration for the one Place release revision. It binds
the `web-runtime` target to `place-web` and the `backend-runtime` target to `place-backend`, with the
Backend image also owning Worker and migration entrypoints. Its deployment state remains
`source-only`; it does not claim a Kustomize/Helm package, Gateway route, Identity client, or active
environment.

`.github/workflows/release-application.yml` is manual-only. It accepts only the current clean `main`
commit after the matching push CI succeeds, publishes `sha-<full-commit>` tags, resolves the
registry index back to exact `linux/amd64` platform digests, validates separate SBOM/provenance
evidence for both images, and runs the Web, Backend, and Worker check from those published digests.
It then creates one checksum-bound `release-record.v1`; it has no GitOps, cluster, Gateway, or
deployment credential. A rerun never replaces a tag. If one image was published before a later
step failed, the workflow verifies that existing image's source/revision labels, publishes only the
missing checkpoint, and rebuilds all evidence. An unreadable tag state, foreign label, malformed
attestation, mutable reference, or mismatched digest fails closed.

Local verification does not publish anything:

```powershell
node scripts/prepare-application-release.mjs verify-source --repository-root .
npm run test:deployment
```

A successful workflow run is required before documentation may claim published release evidence.
Application activation additionally requires environment rollback smoke and the remaining
Identity/Gateway gates.

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
Production application composition is an activation input only. Disposable backup/restore and key
recovery now have source evidence, while environment promotion still waits for retained operational
backup evidence, published image/SBOM/provenance evidence, deployment rollback smoke,
Identity/Gateway, and public-path validation.

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

Run the recovery rehearsal separately with Docker available:

```powershell
$env:PLACE_DATABASE_TEST_HOST='<test-owned-host>'
npm run test:database-recovery
```
