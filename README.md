# Place

Shared domain terminology is defined in [`CONTEXT.md`](CONTEXT.md). Detailed documentation starts at
[`docs/README.md`](docs/README.md).

Place is an independent personal place platform for provider-neutral place identity, source
evidence, personal libraries, visits, writing, imports, sharing, and future Tool access.

Current delivery state: **source-only, Stage 3 in progress**. Independent web/backend composition
roots, Place access policy/OIDC adapters, contracts, architecture checks, deterministic shell tests,
a source-only physical PostGIS declaration, a tested database preparation/migration command, and
access-owned membership/consent plus encrypted browser-auth PostgreSQL persistence exist. Protected
Web OIDC secret-file loading, fail-closed Next startup installation, periodic bounded expiry cleanup,
signal-owned pool closure, and reviewed fail-closed browser auth handlers also exist as source-only
platform interfaces. Strict backend transports publish current consents, consent-gated onboarding,
and audited authority-role administration. The Web BFF owns browser consent/onboarding routes and a
fixed server-to-server backend client so access tokens remain outside browser payloads. These routes
fail closed or remain unregistered until their process dependencies are explicitly supplied. There
is no active application database connection, provider account, map credential,
Identity client, Gateway route, or AI Tool connection.

## Repository boundaries

```text
apps/web/                  Next.js product surface
backend/                   TypeScript HTTP/worker/module boundary
packages/contracts/        owner-controlled machine-readable contracts
tests/                     repository-wide architecture, contract, integration, and E2E tests
docs/                      routed product, architecture, domain, API, data, security, and operations docs
deploy/                    source-only deployment declarations; no active public route
```

Read [`docs/README.md`](docs/README.md) before working. The workspace plan lives at
[`../plans/place-platform-service-implementation.md`](../plans/place-platform-service-implementation.md).

## Validation

After dependencies are installed and locks are current:

```powershell
npm run check
```

Narrow commands:

```powershell
npm run check:web
npm run check:backend
npm run check:contracts
npm run test:database
npm run test:e2e
```

`test:database` requires Docker plus an injected `PLACE_DATABASE_TEST_HOST` and creates only a
disposable, randomly credentialed PostGIS container. It is separate from the default source check
until a Docker-enabled CI job owns it.

The repository does not require sibling repositories at runtime or test time.
