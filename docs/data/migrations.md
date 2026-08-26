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

Migration `000018` replaces the legacy owner index with a unique Owner constraint and creates the
singleton `access.platform_owner_projection` checkpoint. It records authority/owner revision,
preserved prior Place role, assertion expiry, and observation time; the runtime role receives only
the bounded select/update access required for atomic projection. Audit events add the
`platform-owner-projection` kind.

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

Migration `000010`은 append-only `taxonomy.node_versions`를 추가한다. `000011`은 Search가
소유하는 public place document와 membership별 signal projection을 추가하고 text GIN,
location GiST, Taxonomy GIN index를 만든다. 이 schema는 다른 owner table에 foreign key나
runtime join을 두지 않는다. source version이 더 큰 projection만 현재 row를 갱신한다.

Migration `000012`는 `search.suggestion_sessions`, `search.suggestion_impressions`,
`search.discovery_candidates`를 추가한다. session과 impression은 짧은 TTL을 가지며 Discovery는
공급자 후보의 정규화된 표시 정보·출처·위치·최종 관측만 가진 재구축 가능한 projection이다.
text에는 `pg_trgm` GIN, 위치에는 GiST, 만료 정리에는 ordered index를 둔다. impression 단계에는
Ingestion이나 Places table insert가 없고, 만료 정리는 Search table에만 delete 권한을 사용한다.

Migration `000015`는 Import item과 batch에 `enriching` 상태·count를 추가하고, Provider Place
Identity별 공동 Fulfillment Job, 회원별 item intent, fenced attempt를 생성한다. `(provider_key,
provider_place_id)` unique 제약으로 여러 회원의 같은 장소 상세 요청을 한 작업으로 합친다. runtime
role은 이 작업 상태에 필요한 DML만 가지며 Places·Library schema를 직접 조회하는 권한을 Ingestion
Adapter에 추가하지 않는다.

Migration `000019`는 불투명 합성 key에서 Provider의 `source_item_id`를 분리해 list/item identity를
각각 보존한다. Provider Place Identity별 상세 상태는 `pending` 또는 정규화된 Source Observation을
가리키는 `available`만 허용한다. `library.collection_place_import_provenance`는 Collection membership과
같은 transaction에서 Source Connection·List·Item·Provider Place ID를 보존하며, Provider 상세 실패가
이미 저장된 private Collection을 되돌리지 않게 한다.

Migration `000020`은 Collection membership이 아니라 Provider·Connection·List·Item 원본 식별자를
장소 provenance의 key로 사용해 같은 membership에 합쳐진 여러 Source Item을 모두 보존한다. 상세
`available` 참조는 같은 Provider Place Identity의 `provider-detail` Source Observation과 그 관찰에서
정규화된 Place Candidate를 묶은 `provider_place_detail_observations`만 가리킬 수 있다.
