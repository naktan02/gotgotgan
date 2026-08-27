# Library 모듈

Library는 회원의 저장·가고 싶음 상태, 현재 Personal Rating, 평점 변경 이력, Collection,
Tag, 복사 provenance를 소유한다. Visit은 소유하지 않으며 `visited` 상태를 별도 flag로
저장하지 않는다.

application interface는 멱등 domain command를 받는다. persistence는 table별 repository가
아니라 하나의 깊은 adapter로 제공한다. 공개 Collection 조회는 owner ID, Tag, Rating,
Visit, private record를 반환할 수 없는 별도 허용 목록 projection을 사용한다.

회원 read는 command Store와 분리된 `LibraryQueries` Interface를 사용한다. 저장·가고 싶음·평점
Place, Collection 목록/상세, Tag 목록은 최대 50개와 용도별 opaque keyset cursor로 제한된다.
Collection 상세의 Place membership도 별도로 page한다. 잘못된 filter 또는 다른 Collection에서
가져온 cursor는 재사용할 수 없다.

Place 목록은 최대 20개의 Tag ID를 `all` 또는 `any`로 결합한다. Tag 이름은 표시·수정 가능한
회원 데이터이고 query identity로 쓰지 않는다. cursor는 state, 정렬된 Tag ID, match mode에 모두
묶여 다른 분류 조합에서 재사용할 수 없다. `라면`, `성수동`, `쇼유라멘`처럼 서로 다른 축의 Tag를
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

연결 계정 Import의 Library 공개 interface는 Canonical Place 저장, Provider Source List에 대응하는
private Collection 생성·재사용, 정렬된 membership, import provenance와 command receipt를 한
transaction으로 처리한다. Ingestion은 Library table을 조회하지 않으며 source list ID·이름·순서만
consumer port로 전달한다. 회원이 Collection 이름을 수정하면 이후 재가져오기가 이를 덮어쓰지 않는다.
