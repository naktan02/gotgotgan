# Library 모듈

곳곳간의 즐겨찾기 truth는 회원 소유 Collection membership이다. Library는 Collection과 순서,
Tag, 현재 Personal Rating, 평점 변경 이력, import·copy provenance를 소유한다. Rating과 Tag는
Collection membership과 독립이며 마지막 membership 제거로 삭제하지 않는다. Visit과 Writing은
각 소유 Module에 남고 Library가 상태를 복제하거나 schema를 직접 join하지 않는다.

새 Collection-first Seam은 `PersonalLibraryWorkspace`, `PlaceFiling`, `CollectionOrder`를 흔한 사용자
흐름에 제공하고, `ImportedCollectionMaterializer`, `PublishedCollectionExchange`,
`PersonalRatingLedger`를 특수 흐름에 제공한다. 호출자는 불투명 version과 `first`/`last`/
`before`/`after` anchor만 사용하며 database 정수 position을 알지 못한다. 같은 operation ID와 정규화된
요청은 원래 결과를 replay하고, 타인 소유와 미존재 resource는 같은 `not-found` 경계로 축약한다.

아래 `LibraryCommand`, `LibraryQueries`, `saved`/`wanted` 설명은 기존 source-only v1 소비자를 위한
Compatibility Adapter의 현재 구현이다. 새 기능을 이 경계에 추가하지 않으며 Web·Import·Search를
Collection-first Interface로 전환한 뒤 제거한다. `000035` migration은 이 전환에 필요한 revision,
v2 operation receipt, N:1 source-list binding과 부분 복사 provenance를 additive하게 준비한다.

현재 `PersonalLibraryWorkspace`는 공개 장소 summary가 없는 항목에 한해 별도 회원 전용 reader로
성공한 가져오기의 최소 이름·좌표를 표시한다. Transfers 공개 Interface를 조립 계층이 주입하며 Library가
Transfers table을 직접 join하지 않는다. 이 값은 `unverified`이고 지역·Taxonomy를 추측하지 않는다.
공개 summary가 있으면 그것을 우선하며, 공개 Collection·다른 회원·legacy v1 reader에는 이 보강을
주입하지 않는다. 개인 즐겨찾기 별명이 공개 장소 정보로 발행되는 경로도 만들지 않는다.

## Collection-first 검색과 지도

`personal-library-workspace.v2`의 선택 입력 `collectionQuery`와 `placeQuery`는 각각 최대 160자다.
입력을 생략한 기존 요청·응답은 바뀌지 않는다. 새 소비자는 새 Backend와 함께 배포하며, 구버전
서버에 검색이 지원된다고 가정하지 않는다. Collection 이름 검색은 회원 소유 directory 전체를 SQL로
검색한 후 page한다. 장소 검색은 NFKC·공백·대소문자를 정규화하고 모든 공백 구분 단어가 이름,
지역 표시명, 현재 primary 분류 표시명 또는 해당 회원의 Tag 이름에 포함되는지 검사한다. 자연어
지역 해석이나 미등록 음식 세부 분류를 추론하지 않으며, 메모·다른 회원 Tag·공개 publication은 읽지 않는다.

지역·분류 또는 검색어가 있는 장소 page는 요청당 최대 500개 membership 후보를 검사한다.
일치 결과가 없는 page라도 남은 후보가 있으면 `placeNextCursor`가 있으므로 소비자는 이어 읽기를
종료하면 안 된다. Collection과 장소 cursor는 회원·scope·필터·검색어에 묶이고 다른 조건에 재사용할
수 없다. 결과 총수를 현재 page 수로 꾸미지 않는다. `availableFilters`는 선택 Collection 또는 전체
membership의 최대 2,000개 표본과 축별 상위 50개이며, 선택한 Tag·Rating·검색어의 전체 집계가 아니다.
sample/projected coverage와 `complete`를 함께 표시해야 하며 미투영은 분류 부재의 증거가 아니다.

선택 목록이 directory 첫 page 밖에 있어도 이름·revision이 사라지지 않도록 새 UI는
`includeSelectedCollection=true`로 현행 `selectedCollection` summary를 명시적으로 요청한다.
이 metadata는 별도 소유권 확인을 거치고 directory 검색어와 독립적이다. 입력 생략 또는 전체 scope는
해당 필드를 생략하므로 기존 strict v2 응답 소비자를 변경하지 않는다.

새 `GET /v2/library/workspace/map` (`personal-library-map.v2`)는 frozen legacy map v1과 분리한다.
동일 회원 membership·Rating·Tag·지역·분류·`placeQuery` 조건을 목록과 공유하고, 목록 cursor 없이
500개씩 모든 후보를 읽는다. public/member summary port와 같은 텍스트 predicate를 재사용하며
grid cell별 누적값만 메모리에 보존해 모든 좌표를 최대 500개 point/cluster로 표현한다. 알려진 위치가
없는 일치 장소와 아직 검색 일치 여부조차 판단할 수 없는 미투영 후보는 `unprojectedPlaceCount`로
드러낸다. 요청 종료·5초 deadline을 batch 경계에서 검사하며, 끝까지 읽지 못하면 503으로 실패하고
부분 결과를 `complete`로 보내지 않는다. 내부 SQL·summary 호출 하나의 즉시 강제 취소는 제공하지 않는다.

회귀 근거는 `backend/tests/integration/library-queries/workspace-search-map.test.mjs`다. 실제 임시
PostGIS에서 500개 이후 일치 결과, 회원·Tag 격리, query-bound cursor, directory 전체 검색,
목록과 별개인 전체 지도 집계와 batch 경계 취소를 검증한다. 실제 서비스 활성화나 외부 지도 공급자
연동 성공을 의미하지 않는다.

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

`PublicCollectionDiscovery` v2는 링크 공유용 unlisted read와 분리된다. `public` Collection이면서
작성자 Profile도 `public`이고 moderation 상태가 `allowed`일 때만 디렉터리·상세·복사에 나타난다.
검색, 지역, Taxonomy, 공개 주제와 정렬은 filter-bound opaque keyset cursor를 사용하고, 상세 cursor는
Collection revision에서 만든 `publicationVersion`에 묶인다. 상세 read는 repeatable-read snapshot에서
metadata와 순서를 읽으며, 변경 후 이전 cursor는 거절한다.

v2 공개 목록 복사는 새 private Collection만 만든다. source Collection row와 공개 Profile row를 같은
transaction에서 잠그고 `expectedPublicationVersion`을 검증한 뒤 Canonical Place ID와 공개 상대 순서만
옮긴다. 부분 선택은 source membership을 전부 검증하며, operation receipt와 원본 position provenance도
같이 commit한다. 이 Adapter에는 Rating, Tag, Visit, Writing, 개인 사진 table을 읽는 의존성이 없다.
따라서 공개 상태가 취소되거나 Profile이 숨김·withheld된 경우 상세와 복사는 모두 일반화된 not-found로
끝나며, 응답 유실 재시도는 같은 결과만 replay한다.

facet 집계도 같은 public Place summary reader만 사용한다. 최근 saved Place 최대 2,000개와 지역·
primary Taxonomy 상위 50개씩으로 제한하고 saved/sample/projected coverage를 반환한다. facet-filtered
목록은 요청당 최대 500개 preference만 검사하며 남은 후보는 purpose-bound cursor로 이어 간다.
지역 key는 정규화한 현재 표시명 기반이어서 서로 다른 언어 표기를 같은 지역이라고 추측하지 않는다.

연결 계정 Import의 Library 공개 interface는 Canonical Place 저장, Provider Source List에 대응하는
private Collection 생성·재사용, 정렬된 membership, import provenance와 command receipt를 한
transaction으로 처리한다. Ingestion은 Library table을 조회하지 않으며 source list ID·이름·순서만
consumer port로 전달한다. 회원이 Collection 이름을 수정하면 이후 재가져오기가 이를 덮어쓰지 않는다.
