# Backend migrations

This directory owns ordered TypeScript schema migrations executed only by the database preparation
operator command as `place_owner`. Filenames use a zero-padded monotonic prefix. Never edit an
applied migration; append a new file and keep every schema, grant, index, and rollback explicit.

Migrations define storage shared by module-owned persistence adapters. They are not repositories and
must not import business modules or another project.

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
