# Data documentation

- `ownership-and-isolation.md`: database and role ownership.
- `postgresql-postgis.md`: preferred topology and Infra gate.
- `migrations.md`: schema-change lifecycle.
- `captures-and-retention.md`: raw evidence storage and deletion.
- `backup-and-restore.md`: recovery ownership and proof.

The source-only database declaration, preparation command, canonical Place migration, normalized
access and membership-consent migrations, encrypted browser-auth migration, and corresponding
persistence adapters exist. Immutable ingestion evidence/candidates/decisions and canonical
provider-link/redirect/lineage migrations plus their PostgreSQL adapters also exist. A disposable
Search suggestion migration owns short-lived sessions and impressions plus a replaceable Discovery
Projection with text, spatial, and bounded-cleanup indexes. It stores no personal library state and
does not make displayed candidates canonical. A disposable capture migration and maintenance path
retain audit metadata while physically deleting expired encrypted artifacts from a private volume.
A separate Fulfillment migration owns Provider Identity별 공동 job, 회원별 intent, fenced attempt와
`enriching` progress를 추가하며 Ingestion이 Places·Library table을 직접 조회하지 않는 module 경계를
유지한다.
Resolution은 별도 schema에서 Provider Identity별 최신 raw-preserving comparison representation과
append-only Match Assessment를 소유한다. text·location·phone·website 후보 index는 bounded 비교만
지원하며 assessment에 Canonical mutation 권한을 주지 않는다.
Versioned shadow Place Cluster Proposal은 header, Provider member, supporting assessment 관계를 별도
table로 정규화한다. Provider별 열은 read projection에서만 동적으로 만들며 저장 schema에는 없다.
Library/Visits/Writing의 member-scoped 목록은 owner schema의 bounded keyset index와 별도 query
Interface를 사용한다. Visit 내부 fingerprint/evidence와 Writing 전체 본문은 목록 projection에
포함하지 않는다.
A disposable two-runtime rehearsal verifies database-level backup,
isolated restore, credential rotation, spatial contract recovery, and matching browser-session key
recovery. No Place application process is connected to a provisioned database.
