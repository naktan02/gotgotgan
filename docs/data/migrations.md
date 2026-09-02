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

Migration `000021`은 `provider_place_detail_jobs`와 fenced attempt 이력을 추가한다. 상세 상태는
`unavailable`을 명시할 수 있고, Job의 lease/retry/failure는 상태 projection과 별도 table에 남는다.
성공 transaction은 이미 기록된 immutable detail Observation/Candidate의 identity를 검증한 뒤
`available` 참조를 설정하며 Canonical Place나 회원 Library를 직접 변경하지 않는다.

Migration `000022`는 Resolution 소유 `place_evidence_index`와 append-only
`match_assessments`를 추가한다. 전자는 Provider Place Identity별 최신 관찰의 raw/derived 비교
representation이며 더 새 관찰에 한해서만 교체된다. 후자는 정렬된 관찰 pair와 policy version,
feature, reason, confidence, fingerprint를 보존한다. `pg_trgm` name/address GIN, geography GiST,
phone/website partial index가 bounded candidate blocking을 지원한다. runtime role은 assessment를
insert/select만 할 수 있고 update/delete 권한이나 Places schema 권한은 추가되지 않는다.

Migration `000023`은 `resolution.place_cluster_proposals`, `place_cluster_members`,
`place_cluster_assessments`를 분리한다. proposal은 policy/input fingerprint가 같은 실행을 replay하고,
member는 Provider Place Identity와 immutable Source Observation을 행으로 저장하며, assessment link는
양 끝 observation이 같은 proposal의 member인지 복합 foreign key로 검증한다. 세 table에는
NAVER/Google/Kakao/Tabelog 고정 column이나 Canonical Place mutation reference가 없다.

Migration `000024`는 Library Place 목록의 세 실제 filter에 맞춘 partial keyset index를 만든다.
각 index는 `(membership_id, updated_at DESC, canonical_place_id)` 순서이고 saved, wanted,
Personal Rating 존재 조건을 서로 분리한다. Collection owner index에도 `id` tie-breaker를 포함해
동일 시각 갱신에서도 cursor 순서를 안정화한다. schema/권한/데이터 shape 변경은 없다.

Migration `000025`는 Visit history의 `(membership_id, canonical_place_id, visited_at DESC, id)`와
Writing list의 `(owner_membership_id, updated_at DESC, id)` index로 기존 정렬 index를 교체한다.
opaque keyset cursor의 동률 순서를 실제 index 순서와 일치시키며 새 table이나 권한을 추가하지 않는다.

Migration `000026`은 ImportBatch의 상태별 회원 이력과 ImportItem의 Provider 원본 순서에 맞춘
두 composite index를 추가한다. 각각 `(member_id, state, created_at DESC, id)`와
`(batch_id, source_list_position, source_position, id)` 순서이며, 새 table·권한·Provider별 열 없이
bounded keyset query만 지원한다.

Migration `000027`은 Tag-first 회원 Place 조회를 위해
`(membership_id, tag_id, canonical_place_id)` index를 추가한다. Collection position uniqueness를
deferrable constraint로 바꿔 한 transaction 안의 충돌 없는 순서 이동을 허용하고, runtime에는
owner 조건을 거친 Collection/Tag 삭제와 Library-owned Import/copy provenance 정리에 필요한 DELETE만
추가한다. Collection과 Tag의 정규화된 table 관계나 Provider별 column은 추가하지 않는다.

Migration `000028`은 `writing.document_place_links`에
`(canonical_place_id, document_id)` index를 추가한다. document와 Place의 정규화 관계는 그대로 두고
선택 Place에서 owner Writing을 역조회할 때 전체 회원 글을 browser가 순회하지 않게 한다. schema shape와
runtime 권한은 바꾸지 않는다.

Migration `000029`는 `access.membership_resource_grants` constraint에 `library.share`만 추가한다.
Collection table이나 공개 projection shape는 바꾸지 않으며, Product Authorizer가 공유 기능을 일반
write와 별도로 판단할 수 있는 최소 권한 seam만 만든다. 활성 share grant를 지우지 않도록 rollback은
해당 grant가 있으면 fail closed한다.

Migration `000035`는 사용자 Collection membership을 즐겨찾기의 단일 truth로 전환한다. 기존
`saved`/`wanted` column을 즉시 삭제하지는 않지만 새 Interface에서는 사용하지 않는다. Collection,
회원 Collection/Tag, Personal Rating에 독립 revision을 추가하고, 응답 유실 재시도에 같은 결과를
돌려주는 v2 operation receipt를 만든다. Provider Source List binding은 Source List를 key로 삼아 여러
목록이 같은 Collection을 가리킬 수 있고, 공개 목록 부분 복사는 operation과 원본 순서별 Item
provenance를 보존한다. 전환 전 미분류 legacy Place가 있으면 자동 `저장됨`/`가고 싶음` Collection을
만들지 않고 migration을 중단해 사용자가 선택한 분류로 먼저 정리하게 한다.

Migration `000036`은 Provider raw payload를 복사하지 않는 typed assertion ledger와 immutable
Canonical Place Profile revision을 추가한다. 한 batch는 한 subject와 Source Observation을 공유하고
field별 confidence를 보존한다. 발행은 expected revision, policy version, rationale, exact selected
assertion을 요구하며 성공 receipt와 current pointer, bounded catalog change를 한 transaction으로
전진시킨다. Canonical identity 상태와 현실 영업 상태는 별도 열과 수명주기로 유지한다.

Migration `000037`은 Area를 주소 문자열에서 분리해 stable key와 다국어 계층 version으로 만든다.
version은 v1부터 predecessor를 빠짐없이 잇고, 최신 active same-country parent만 참조한다. Provider
category mapping과 Canonical Profile의 Taxonomy·Area assignment는 exact version 및 선택 근거
assertion을 보존한다.

Migration `000038`은 Provider media URL 대신 opaque Provider media identity 또는 내부 object reference를
source identity로 보존한다. rights revision은 append-only이며 허용 surface, 근거, 유효 기간과 필수
attribution을 명시한다. Profile 선택만으로는 공개 권리가 생기지 않고 안전 projection과 delivery
Adapter가 현재 허용된 media만 URI로 해석한다.
