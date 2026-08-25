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
