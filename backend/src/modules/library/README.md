# Library 모듈

Library는 회원의 저장·가고 싶음 상태, 현재 Personal Rating, 평점 변경 이력, Collection,
Tag, 복사 provenance를 소유한다. Visit은 소유하지 않으며 `visited` 상태를 별도 flag로
저장하지 않는다.

application interface는 멱등 domain command를 받는다. persistence는 table별 repository가
아니라 하나의 깊은 adapter로 제공한다. 공개 Collection 조회는 owner ID, Tag, Rating,
Visit, private record를 반환할 수 없는 별도 허용 목록 projection을 사용한다.

`set-place-preferences`는 saved/wanted/Personal Rating의 목표 상태 전체와 정규화된
`expectedUpdatedAt`을 받는다. preference write leaf가 회원·Place별 advisory transaction lock,
현재 버전 비교, 단조 증가 timestamp, Rating event를 한 transaction에 숨긴다. stale write는
retryable 409이며 command 영수증이나 preference를 만들지 않는다. 이미 적용된 같은 command ID는
버전 비교 전에 replay되므로 응답 유실 후에도 중복 Rating event를 만들지 않는다.

회원 read는 command Store와 분리된 `LibraryQueries` Interface를 사용한다. 저장·가고 싶음·평점
Place, Collection 목록/상세, Tag 목록은 최대 50개와 용도별 opaque keyset cursor로 제한된다.
Collection 상세의 Place membership도 별도로 page한다. 잘못된 filter 또는 다른 Collection에서
가져온 cursor는 재사용할 수 없다.

HTTP composition은 `LibraryQueries`를 필수로 주입한다. command Store는 회원의 전체 Library를
무제한 aggregate로 반환하지 않으며 단건 Place preference만 명시적으로 읽는다. 공개 Collection은
`LibraryQueries`가 공개 가능한 Collection field와 정렬된 Place reference를 읽고, 조립 계층이
주입한 Place summary reader로 보강한다. 따라서 테스트도 실제 소비자가 사용하는 query Interface를
통해 상태를 확인한다.

Place 목록은 최대 20개의 Tag ID를 `all` 또는 `any`로 결합한다. Tag 이름은 표시·수정 가능한
회원 데이터이고 query identity로 쓰지 않는다. 저장 Place에서 파생한 지역·primary Taxonomy facet은
각 축의 안정 key를 최대 10개까지 받으며 축 안은 OR, 축 사이는 AND로 적용한다. cursor는 state,
정렬된 Tag ID, match mode, 지역·Taxonomy key에 모두 묶여 다른 조합에서 재사용할 수 없다. `라면`, `성수동`, `쇼유라멘`처럼 서로 다른 축의 Tag를
한 Place에 동시에 붙일 수 있으며 자동 분류는 이 수동 truth를 바꾸지 않는 별도 후속 기능이다.

Collection은 순서가 있는 목록, Tag는 다대다 교차 분류다. 멱등 command는 Collection 이름 변경,
Place 추가·이동·제거, Collection 삭제와 Tag 이름 변경·부착·해제·삭제를 지원한다. 순서 재배치는
한 transaction에서 uniqueness를 지키며, Import provenance가 있는 membership/Collection 삭제도
해당 Library-owned provenance를 함께 정리한다. PostgreSQL command write는 query와 imported-save
수명주기를 비대하게 만들지 않도록 preference, ordered Collection, Tag Adapter leaf로 나눈다.

`set-collection-publication`은 소유자 Collection의 `updatedAt`을 예상 버전으로 받아 private,
unlisted, public을 전환한다. 첫 공유의 publication ID는 PostgreSQL transaction 안에서 만들고
unlisted/public 전환에는 유지한다. 공유 해제는 ID를 제거하므로 이전 링크가 즉시 not-found가 되며,
다시 공유하면 새 ID를 만든다. 이 command만 transport의 `library.share` 권한을 사용해 향후 Product
Tier 정책을 Collection 구현에 넣지 않는다. `copy-published-collection`은 공유 row를 잠근 뒤 정렬된
Place reference만 새 회원 소유 private Collection으로 복사하고 provenance를 남긴다.

회원 목록 카드와 공개 Collection의 이름·위치·Taxonomy는 entrypoint가 주입한
`LibraryPlaceSummaryReader`로 요청당 한 번에 조회한다. `PostgresLibraryQueries`는 Library schema만
읽으며 Search table을 join하지 않는다. `place-published-collection.v3`는 전체 Place 수와 기본·최대
50개의 정렬 page, 다음 opaque cursor를 반환한다. cursor는 publication ID와 Collection `updatedAt`,
마지막 순서·Place ID에 묶여 다른 공개본 또는 변경된 공개본에서 재사용할 수 없다. 각 row는 Place
ID·순서와 공개 summary만 포함하며 공개 Place projection이 아직 없더라도 preference나 Collection
membership을 삭제하지 않고 `place: null`로 반환한다.

`getMapProjection`은 bounded 목록 page와 독립된 지도 read다. 회원의 authoritative state/Tag 또는
소유 Collection에서 Place ID scope를 만든 뒤, 주입된 `LibraryMapPlaceReader`가 Search-owned 좌표를
현재 bounds 안에서만 읽는다. Library Adapter는 Search schema를 join하지 않는다. 지역·Taxonomy
filter는 같은 summary 의미를 재사용하고 zoom별 grid가 모든 projected Place를 최대 500개의 point 또는
count-bearing cluster로 표현한다. 따라서 feature 수는 제한해도 대표되는 Place 수를 자르지 않는다.
scope에 좌표 projection이 없는 Place 수는 `unprojectedPlaceCount`로 드러낸다.

`getPublishedCollectionMap`도 공개 목록 cursor와 독립된 read다. 유효한 publication membership만
Place ID scope로 만들고 같은 주입 reader와 clustering policy를 사용해 요청 bounds/zoom의 point 또는
cluster를 반환한다. private/revoked publication은 목록과 지도 모두 같은 not-found 의미이며, 공개
지도에도 membership, Rating, Tag, Visit, Writing, provenance를 투영하지 않는다.

facet 집계도 같은 public Place summary reader만 사용한다. 최근 saved Place 최대 2,000개와 지역·
primary Taxonomy 상위 50개씩으로 제한하고 saved/sample/projected coverage를 반환한다. facet-filtered
목록은 요청당 최대 500개 preference만 검사하며 남은 후보는 purpose-bound cursor로 이어 간다.
지역 key는 정규화한 현재 표시명 기반이어서 서로 다른 언어 표기를 같은 지역이라고 추측하지 않는다.

연결 계정 Import의 Library 공개 interface는 Canonical Place 저장, Provider Source List에 대응하는
private Collection 생성·재사용, 정렬된 membership, import provenance와 command receipt를 한
transaction으로 처리한다. Ingestion은 Library table을 조회하지 않으며 source list ID·이름·순서만
consumer port로 전달한다. 회원이 Collection 이름을 수정하면 이후 재가져오기가 이를 덮어쓰지 않는다.
