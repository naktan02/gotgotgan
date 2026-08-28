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
무제한 aggregate로 반환하지 않으며, 단건 Place preference와 공개 Collection projection만
명시적으로 읽는다. 따라서 테스트도 실제 소비자가 사용하는 bounded Interface를 통해 상태를 확인한다.

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

목록 카드용 이름·위치·Taxonomy는 entrypoint가 주입한 public Place summary reader로 한 번에
조회한다. `PostgresLibraryQueries`는 Library schema만 읽으며 Search table을 join하지 않는다.
공개 Place projection이 아직 없더라도 회원이 저장한 preference나 Collection membership은
삭제하지 않고 `place: null`로 반환한다.

facet 집계도 같은 public Place summary reader만 사용한다. 최근 saved Place 최대 2,000개와 지역·
primary Taxonomy 상위 50개씩으로 제한하고 saved/sample/projected coverage를 반환한다. facet-filtered
목록은 요청당 최대 500개 preference만 검사하며 남은 후보는 purpose-bound cursor로 이어 간다.
지역 key는 정규화한 현재 표시명 기반이어서 서로 다른 언어 표기를 같은 지역이라고 추측하지 않는다.

연결 계정 Import의 Library 공개 interface는 Canonical Place 저장, Provider Source List에 대응하는
private Collection 생성·재사용, 정렬된 membership, import provenance와 command receipt를 한
transaction으로 처리한다. Ingestion은 Library table을 조회하지 않으며 source list ID·이름·순서만
consumer port로 전달한다. 회원이 Collection 이름을 수정하면 이후 재가져오기가 이를 덮어쓰지 않는다.
