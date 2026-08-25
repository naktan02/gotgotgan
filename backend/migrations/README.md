# Backend migrations

This directory owns ordered TypeScript schema migrations executed only by the database preparation
operator command as `place_owner`. Filenames use a zero-padded monotonic prefix. Never edit an
applied migration; append a new file and keep every schema, grant, index, and rollback explicit.

Migrations define storage shared by module-owned persistence adapters. They are not repositories and
must not import business modules or another project.

`000003` adds Web-owned browser OIDC transaction and session persistence. It stores only encrypted
payloads plus authenticated metadata and grants the runtime role select/insert/delete rather than
schema or arbitrary update authority.

`000004` separates data-defined User Grade from Authority Role and Product Tier, then adds versioned
membership-consent evidence and the audited just-in-time onboarding event. Existing rows receive the
neutral migration-only `unclassified` grade; new grades and tiers come from injected Place policy.
The runtime role receives only the select/insert access needed for idempotent consent recording.
`000005` creates immutable ingestion observations, normalized candidates, resolution decisions, and
the candidate spatial index. `000006` extends canonical lifecycle state and adds aliases, provider
identity links, applied-decision idempotency, redirects, and merge/split lineage. The runtime role
may insert evidence and history and perform only the bounded canonical/link updates required by the
module adapter; it cannot update or delete evidence, decisions, redirects, or lineage.

`000007` creates Library preferences, private rating history, Collections, Tags, ordered membership,
copy provenance, and command receipts. `000008` creates append-only Visit occurrences and the member-
Place-time index used for derived summaries. `000009` creates optimistic Note/Entry documents,
ordered Place links, immutable revisions, and command receipts. Runtime grants allow only the
bounded updates used by current projections; rating events, Visits, revisions, copy provenance, and
receipts cannot be rewritten or deleted.
