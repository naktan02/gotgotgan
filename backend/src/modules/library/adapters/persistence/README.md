# PostgreSQL Library adapter

Library schema에 대한 하나의 transaction command 경계를 소유한다. command receipt, 현재
Place Preferences, Personal Rating 이력, Collection·Tag membership, 복사 provenance를
기록한다. 공개 조회는 반환 column을 명시하며 개인 preference나 ownership field를 조회하지
않는다.

일반 목록 조회와 선택 Place의 회원 소유 Collection·Tag 선택지 조회는 별도 query Adapter 파일로
나뉜다. 선택지 projection은 owner 조건과 bounded cursor를 내부에서 강제한다.

지도 조회도 `postgres-library-map-query.ts`에 별도 leaf로 둔다. 이 leaf는 회원 state/Tag 또는 소유
Collection scope만 만들고 좌표·bounds 처리는 주입된 map Place reader에 맡긴다. list cursor나 Search
schema join은 사용하지 않으며 application projection이 point/cluster feature budget을 강제한다.

공개 Collection 목록·지도는 `postgres-published-collection-queries.ts` leaf가 소유한다. 목록은
publication/version-bound keyset cursor와 50개 page를, 지도는 publication membership 전체 scope와
bounds/zoom을 각각 처리한다. 둘은 같은 공개 membership truth를 사용하지만 list row를 map 입력으로
재사용하지 않으며, 공개 summary·좌표는 모두 주입된 reader 뒤에 남긴다.
