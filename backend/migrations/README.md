# Backend migrations

This directory owns ordered TypeScript schema migrations executed only by the database preparation
operator command as `place_owner`. Filenames use a zero-padded monotonic prefix. Never edit an
applied migration; append a new file and keep every schema, grant, index, and rollback explicit.

Migrations define storage shared by module-owned persistence adapters. They are not repositories and
must not import business modules or another project.

`000018`은 유일한 Place Owner 제약과 중앙 `platform_owner` 투영 checkpoint를 추가한다. 이전 Owner의
로컬 역할, authority/owner revision, assertion 만료, 관찰 시각을 저장하며 모든 교체를 감사 이벤트와
같은 transaction에서 처리한다.

`000013`은 Provider connection의 불투명 참조, ImportBatch/ImportItem, durable job lease와 attempt,
캡처 메타데이터, 검토 receipt를 추가한다. 캡처 본문·cookie·비밀번호·실제 profile 경로는 DB에
저장하지 않는다. runtime role은 작업 상태와 preview에 필요한 제한된 DML만 가지며 immutable
evidence의 update/delete 권한은 계속 갖지 않는다.

`000014`는 캡처 본문이 아니라 artifact 삭제 완료 시각 `deleted_at`만 추가한다. 보존기한 전 삭제
표식을 DB constraint로 거부하고 미삭제 만료 행만 찾는 partial index를 유지한다. runtime role은
이 한 column의 UPDATE만 추가로 가지며 캡처 메타데이터의 다른 값이나 immutable evidence를 변경할
수 없다.

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

`000010`은 versioned Taxonomy node history와 current projection을 만들고 runtime에는 append와
read만 허용한다. `000011`은 Search 소유 Place document와 membership signal projection을
만들며 `pg_trgm` text GIN, location GiST, taxonomy array GIN index를 추가한다. 이 schema는
다른 owner table을 조회하는 shortcut이 아니라 versioned projection command로 갱신되는
재구축 가능한 read model이다.

`000012`는 입력 중 검색을 위한 Search 소유 suggestion session, impression, Discovery candidate를
추가한다. Discovery는 `pg_trgm` GIN과 geometry GiST를 사용하고 만료 후 삭제할 수 있다. provider
impression은 evidence UUID를 미리 예약하지만 선택 전 Ingestion row나 Canonical Place를 만들지 않는다.
runtime 권한은 이 세 replaceable Search table의 bounded DML에만 추가된다.

`000015`는 `enriching` Import 상태와 Provider Place Identity별 공동 Fulfillment Job, 회원별
Intent, fenced attempt를 추가한다. ImportItem과 Intent는 같은 transaction에 들어가며 동일 Provider
Identity의 여러 회원 요청은 unique job 하나를 공유한다. 취소된 batch의 intent는 claim되지 않고,
재개하면 다시 pending으로 복원된다. Ingestion persistence가 Places나 Library table을 직접 읽지 않고
각 소유 module interface를 composition으로 주입받는 원칙은 유지한다.

`000016`은 ImportItem에 Provider Source List ID와 목록·장소 순서를 추가하고, 회원별 Collection과
원본 목록의 대응을 기록하는 `library.collection_import_provenance`를 만든다. Provider 목록 재수집은
같은 provenance를 재사용하되 회원이 수정한 Collection 이름을 덮어쓰지 않는다. Library 저장 adapter는
preference, Collection, membership, provenance와 command receipt를 한 transaction으로 반영한다.

`000017`은 회원 브라우저 설치별 Provider connection 재사용, 짧은 수명 Connector operation과
sequence별 capture receipt를 추가한다. grant token은 SHA-256 digest로만 저장하고 공개 origin·Provider·
item/byte/batch 상한을 operation에 고정한다. receipt는 암호화 artifact 메타데이터를 참조하는
`pending`/`committed` 두 단계이며 runtime role은 token 회전, 누적 진행과 완료에 필요한 열만 갱신한다.

`000019`는 ImportItem의 Source List·Item identity를 분리하고 Provider Place Identity별 상세 상태와
Collection Place Import Provenance를 추가한다. `000020`은 provenance의 key를 원본 Source Item
identity로 교체해 같은 membership의 복수 원본을 보존한다. 또한 `provider-detail` Source Observation,
그 관찰의 정규화 Candidate, 동일 Provider Place Identity를 하나의 참조로 묶어 `available` 상세 상태가
임의의 관찰을 가리킬 수 없게 한다.

`000021`은 개인 저장 Materialization과 별개인 Provider Place Detail Job/Attempt를 추가한다. Job은
Provider Place Identity 하나만 받아 lease generation, bounded retry, terminal failure를 기록한다.
성공은 같은 identity의 `provider-detail` Observation과 Candidate가 모두 저장된 뒤에만 상세 상태를
`available`로 바꾸고, 최종 실패는 개인 Library를 되돌리지 않은 채 `unavailable`로 표시한다.

`000022`는 Resolution 소유의 현재 Place Evidence Representation과 변경 불가능한 Match Assessment를
추가한다. 현재 representation만 새 관찰로 교체할 수 있고 원문 다국어 이름은 JSON으로 보존한다.
비교용 이름·주소에는 `pg_trgm` GIN, 위치에는 geography GiST, 전화·website host에는 부분 index를 둔다.
runtime role은 representation의 제한된 upsert와 assessment insert/select만 가능하며 assessment를
update/delete하거나 Canonical Place를 변경할 권한은 얻지 않는다.

`000023`은 immutable versioned Place Cluster Proposal header, one-to-many member, many-to-many
supporting Match Assessment를 각각 정규화한다. 복합 foreign key는 assessment의 양 끝이 실제 proposal
member이고 원본 immutable assessment가 존재함을 강제한다. Provider별 열과 Canonical Place 참조는
없으며 runtime role은 세 table을 insert/select만 할 수 있다.

`000024`는 회원 Library의 bounded keyset 조회를 위한 saved/wanted/rated partial index를 추가한다.
Collection owner 정렬 index에는 안정된 ID tie-breaker를 포함한다. 새 table이나 권한은 만들지 않고
기존 정규화된 preference·Collection·Tag 구조를 그대로 조회한다.

`000025`는 Visit history와 Writing list의 안정된 keyset 순서에 ID tie-breaker를 추가한다. Visit
index는 member·Place 범위 뒤에 `(visited_at DESC, id)`를, Writing index는 owner 범위 뒤에
`(updated_at DESC, id)`를 둔다. table, grant, occurrence, revision 내용은 바꾸지 않는다.

`000026`은 회원별 ImportBatch 이력의 상태 filter와 생성 시각 keyset을 위한
`(member_id, state, created_at DESC, id)` index, ImportItem 원본 순서 상세를 위한
`(batch_id, source_list_position, source_position, id)` index를 추가한다. 기존 Import lifecycle,
capture, provenance, review schema나 runtime 권한은 바꾸지 않는다.

`000027`은 회원 Tag 조합 조회용 `(membership_id, tag_id, canonical_place_id)` index와 transaction
내 Collection 순서 이동용 deferrable unique constraint를 추가한다. runtime DELETE 권한은 owner-scoped
Collection/Tag command가 자기 row와 Library-owned copy/import provenance를 함께 정리하는 table에만
추가한다.

`000028`은 정규화된 Writing Place link에 `(canonical_place_id, document_id)` 역방향 조회 index를
추가한다. 새 table, Provider별 column, runtime 권한은 만들지 않고 선택 Place의 bounded owner Writing
조회만 지원한다.
