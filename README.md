# Place

Place is an independent personal place platform for provider-neutral place identity, source
evidence, personal libraries, visits, writing, imports, sharing, and future Tool access.

Current delivery state: **Stage 1 scaffold**. Only independent web/backend composition roots,
documentation, contracts, architecture checks, and deterministic shell smoke tests exist. There is
no active database, provider account, map credential, Identity client, Gateway route, or AI Tool
connection.

## Repository boundaries

```text
apps/web/                  Next.js product surface
backend/                   TypeScript HTTP/worker/module boundary
packages/contracts/        owner-controlled machine-readable contracts
tests/                     repository-wide architecture, contract, integration, and E2E tests
docs/                      routed product, architecture, domain, API, data, security, and operations docs
deploy/                    future deployment declarations; no active route
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
npm run test:e2e
```

The first scaffold does not require sibling repositories at runtime or test time.
