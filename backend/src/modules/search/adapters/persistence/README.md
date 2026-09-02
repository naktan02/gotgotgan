# 로컬 검색 PostgreSQL adapter

이 adapter는 `search` schema의 Local Search Projection만 읽고 쓴다. `places`, `taxonomy`,
`library`, `visits` schema를 직접 조회하지 않는다. 각 owner가 전달한 versioned projection을
새 버전일 때만 반영하며, 회원 신호는 요청에서 검증된 membership ID로만 결합한다.

홈 Catalog 검색은 같은 `place_documents` projection의 Area `(key, version)`과 bounded Taxonomy
reference JSON만 사용한다. 사람이 읽는 `area_label`과 Taxonomy label은 표시에만 쓰며 exact filter
조건을 대신하지 않는다. Adapter는 Area 또는 Taxonomy schema를 join하지 않는다.
