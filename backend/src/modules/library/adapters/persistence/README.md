# PostgreSQL Library adapter

Library schema에 대한 하나의 transaction command 경계를 소유한다. command receipt, 현재
Place Preferences, Personal Rating 이력, Collection·Tag membership, 복사 provenance를
기록한다. 공개 조회는 반환 column을 명시하며 개인 preference나 ownership field를 조회하지
않는다.

`collection-first/`는 workspace read, Place filing, Collection order, Collection lifecycle을 실제
transaction 변경 이유별 내부 모듈로 묶고 얇은 `index.ts`만 공개한다. 공통 Collection row 해석은
`collection-record.ts` 하나가 소유한다. `queries/`는 일반 Place 목록·facet과 선택 Place의 회원 소유
Collection·Tag 선택지를 묶으며 owner 조건과 bounded cursor를 내부에서 강제한다.

Collection-first `favorite-read.ts`는 목록·지도에서 같은 owner candidate SQL, 회원 전용 summary
보강과 검색 predicate를 재사용하는 비공개 leaf다. `workspace-map.ts`는 독립 viewport의 bounded
batch 순회와 취소를 숨기며 `PostgresPersonalLibraryWorkspace.openMap`만 외부에서 호출한다.
모두 같은 Collection-first read 수명주기의 구현이며 Search/Transfers table을 직접 읽지 않는다.

`map/`은 회원 Library와 공개 Collection의 지도 projection을 같은 지도 변경 이유로 묶는다. 각 leaf는
scope만 만들고 좌표·bounds 처리는 주입된 map Place reader에 맡긴다. 날짜변경선 crossing과 full-world
viewport를 그대로 전달하고 소수 zoom을 보존하며, application projection이 point/cluster budget과
정확한 represented count를 강제한다. list cursor나 Search schema join은 사용하지 않는다.

공개 Collection 목록은 `postgres-published-collection-queries.ts`, 지도는
`map/published-collection-map.ts`가 소유한다. 둘은 같은 공개 membership truth를 사용하지만 list row를
map 입력으로 재사용하지 않으며, 공개 summary·좌표는 모두 주입된 reader 뒤에 남긴다.
