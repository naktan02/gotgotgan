# Place documentation router

This directory is authoritative for repository-local product, architecture, domain, contracts, data,
security, testing, and operations. Workspace-wide ownership and cross-project rules remain in
`../../docs/`.

Read only the routes required by the task, after repository `AGENTS.md` and `README.md`:

- Product scope, terminology, journeys, UI, or reference work: `product/README.md`.
- Module placement, dependencies, processes, or failure behavior: `architecture/README.md`.
- Place concepts, ownership, normalization, visits, writing, sharing, or ingestion: `domain/README.md`.
- HTTP, event, Tool, or stable-reference contracts: `api/README.md` and `../packages/contracts/README.md`.
- PostgreSQL/PostGIS, migrations, isolation, retention, or recovery: `data/README.md`.
- Identity, Gateway, family navigation, maps, providers, or AI: `integrations/README.md`.
- Authorization, credentials, privacy, browser profiles, or raw captures: `security/README.md`.
- Test scope, fixtures, Playwright, or live checks: `testing/README.md`.
- Local execution, worker lifecycle, deployment, backup, or incidents: `operations/README.md`.
- A durable decision or supersession: `adr/README.md`.

Delivery state is **source-only; Stage 4 complete and Stage 2 integration in progress**. A Place-owned physical PostGIS runtime is
declared but not connected or active. No provider account, browser profile, map credential, Identity
client, Gateway route, family composer, or AI connection is active.

Stage 3's source foundation includes immutable ingestion evidence/candidates/decisions and
fingerprint-idempotent canonical create/link/merge/split/retire behavior with redirect and lineage
history. This does not activate a product transport or database environment.

Stage 4 adds member-owned Library, Visits, and Writing source implementations, authenticated Backend
commands, Web-fronted public/unlisted projections, and `place-reference.v1`. Real PostGIS and
desktop/mobile Playwright tests prove history retention, derived visits, and private-field
non-disclosure without making an Identity, Gateway, or deployment flow active.
