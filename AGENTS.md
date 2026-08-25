# Place Repository Working Agreements

The workspace `../AGENTS.md` applies first. This repository owns the Place product and must remain
independently buildable without sibling source trees.

## Required reading

Before any change:

1. read `README.md` and `docs/README.md`;
2. follow the task route in `docs/README.md`;
3. read the nearest boundary `README.md` files;
4. inspect current code, contracts, migrations, tests, recent commits, status, and dirty diff; and
5. for cross-service changes, reread the full workspace document set and
   `../plans/place-platform-service-implementation.md`.

For product/frontend work also read `apps/web/DESIGN.md`. For a decision already covered by the
pre-implementation record, read `../plans/place-platform-stage-0-decision-record.md` and revalidate
its evidence before changing it.

## Ownership and dependency rules

- Place owns canonical places, source observations, personal libraries, visits, writing, sharing,
  provider connections/imports/sync, Place authorization, and Place contracts.
- Identity supplies `(issuer, subject)` only. Place owns membership, roles, tiers, grants, and final
  resource authorization.
- Gateway owns public ingress only. Never add a public route before the workspace onboarding gate.
- Never read or mutate another product database or import sibling source.
- Cross-project use requires a versioned network or released-package contract.
- Never expose database, provider, workload, profile, capture-store, or internal-route credentials
  or references to a browser.

Backend modules live below `backend/src/modules/<module>`. Domain and application code
do not import transport, framework, persistence, or provider implementations. A module owns its
incoming transports and adapters; root entrypoints only compose them. Do not create repository-wide
`controllers`, `services`, or `repositories` folders.

The HTTP server and acquisition worker are separate process entrypoints in one backend package.
Interactive writes go through the always-available HTTP process. Acquisition runs through durable
jobs and may be started on demand; process entrypoints never own business rules.

Frontend direction is:

```text
app -> shells/features/domains/platform/shared
shells -> features/domains/platform/shared
features -> domains/platform/shared
domains -> platform/shared
platform -> shared
shared -> no upper layer
```

Do not create top-level `components`, `services`, `stores`, or `hooks` dumping grounds. A route file
is a thin framework adapter. Shells compose features; provider/browser SDKs belong to platform;
business-neutral primitives alone belong to shared.

## Change and validation rules

- Preserve existing dirty changes and make the smallest in-scope change.
- Add migrations for schema changes; the runtime role never owns schema or runs DDL.
- Treat provider payloads as observations, not canonical overwrite commands.
- Use deterministic fixtures for blocking tests. Live provider and map checks are opt-in.
- Update owning docs, machine-readable contracts, tests, and the workspace implementation ledger
  with the same completed stage change.
- Run `npm run check` from the repository root before handoff. Run narrower commands only during
  iteration and report anything not run.
- Review the complete diff and ensure it contains no secret, user data, internal address, raw
  provider payload, or browser profile material.
