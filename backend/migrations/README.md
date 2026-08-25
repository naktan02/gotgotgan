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

`000007`은 Library preference, 비공개 Rating 이력, Collection, Tag, 정렬된 membership, 복사
provenance, command receipt를 생성한다. `000008`은 append-only Visit occurrence와 파생 summary에
사용하는 member-Place-time index를 생성한다. `000009`는 optimistic Note/Entry document,
정렬된 Place link, 변경 불가능한 revision, command receipt를 생성한다. runtime grant는 현재
projection에 필요한 제한된 update만 허용하며 rating event, Visit, revision, 복사 provenance,
receipt는 수정하거나 삭제할 수 없다.
