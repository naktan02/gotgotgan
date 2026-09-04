# 로컬 검색 PostgreSQL adapter

이 adapter는 `search` schema의 Local Search Projection만 읽고 쓴다. `places`, `taxonomy`,
`library`, `visits` schema를 직접 조회하지 않는다. 각 owner가 전달한 versioned projection을
새 버전일 때만 반영하며, 회원 신호는 요청에서 검증된 membership ID로만 결합한다.

홈 Catalog 검색은 같은 `place_documents` projection의 Area `(key, version)`과 bounded Taxonomy
reference JSON만 사용한다. 사람이 읽는 `area_label`과 Taxonomy label은 표시에만 쓰며 exact filter
조건을 대신하지 않는다. Adapter는 Area 또는 Taxonomy schema를 join하지 않는다.

`PostgresCatalogMapSearch`도 같은 projection과 exact reference filter만 읽는다. 넓은 viewport는
PostGIS 좌표를 viewport-relative grid로 묶고, 날짜변경선 viewport는 longitude를 일시적으로 unwrap한
뒤 응답 좌표를 다시 `[-180, 180]`으로 돌린다. count·feature는 read-only repeatable-read transaction
하나에 묶어 coverage가 동시 projection 갱신 때문에 어긋나지 않게 한다.

`PostgresLocalSearch`는 write와 두 검색 interface를 유지하고, 좌표 projection row 해석과 bounded
document read SQL은 내부 `PostgresSearchProjectionReader`에 숨긴다. 이 내부 모듈은 날짜변경선
crossing을 두 PostGIS envelope로 읽고 exact projection coverage를 반환한다. Catalog 목록도 같은
crossing semantics를 적용하지만 provider-backed legacy 검색의 non-wrapped bounds 계약은 넓히지 않는다.
viewport 집계처럼 transaction·coverage 불변식과 변경 이유가 다른 기능은
`PostgresCatalogMapSearch`라는 동급 Adapter로 유지한다.
