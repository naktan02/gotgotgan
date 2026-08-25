# Migrations

ADR 0005 selects pinned `node-pg-migrate` with TypeScript migration files under
`backend/migrations/`. `npm run database:prepare --workspace @place/backend` is the single operator
interface. It reads administrator, migration, and runtime credentials from deployment-owned secret
files named by `deploy/database-runtime.json`; verifies the target database and authority; provisions
marked least-privilege login roles; creates administrator-owned PostGIS; and then runs pending
migrations as `place_owner`.

Migration history lives in `place_migrations.applied_migrations`. The runner checks file order, uses
one transaction for the pending batch, and fails rather than waiting when another runner owns the
advisory lock. Never edit an applied migration: append the next zero-padded migration and provide an
explicit `down` action when rollback can preserve the contract safely. SQL that cannot be
transactional must justify `noTransaction` and a separate recovery procedure before merge.

The first migration owns `places.canonical_places`, keeps location nullable for physical and
service-area identities, and adds a partial GiST index for located records. Runtime DML grants are
explicit. The second migration owns normalized access memberships/resource grants and append-only
audit events. It grants no membership or audit deletion authority. The third migration adds
`browser_auth` one-time transactions and immutable sessions. Only encrypted payloads and authenticated
metadata are stored; `place_app` receives select/insert/delete but no update or DDL authority.
Application startup never receives administrator/migration credentials and never performs DDL.

Migrations `000005` and `000006` add the Stage 3 resolution foundation. `ingestion` tables retain
append-only Source Observations, Place Candidates, and Resolution Decisions. `places` adds canonical
status/version, aliases, provider identities, applied-decision fingerprints, redirects, and lineage.
The runtime role can perform only required inserts plus bounded canonical/provider-link updates. It
cannot rewrite or delete evidence, resolution decisions, redirects, or lineage.

Migration `000007`부터 `000009`는 독립된 Library, Visits, Writing schema를 추가한다. Library는
비공개 Personal Rating 변경과 복사 provenance를 보존한다. Visit은 append-only다. Writing은
현재 document를 optimistic하게 갱신하면서 변경 불가능한 revision을 보존한다. runtime
column grant는 현재 projection과 정렬된 link에 필요한 범위로 제한하며 history와 receipt는
insert/select만 허용한다.
