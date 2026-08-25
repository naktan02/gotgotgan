# 로컬 검색 PostgreSQL adapter

이 adapter는 `search` schema의 Local Search Projection만 읽고 쓴다. `places`, `taxonomy`,
`library`, `visits` schema를 직접 조회하지 않는다. 각 owner가 전달한 versioned projection을
새 버전일 때만 반영하며, 회원 신호는 요청에서 검증된 membership ID로만 결합한다.
