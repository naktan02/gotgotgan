# Search 모듈

Search는 provider-neutral 제출 검색, 입력 중 자동완성 조정, Local/Discovery Search Projection을
소유한다.

## 현재 웹 검색 경로

이름 후보와 조건 해석이 혼동될 때는
[`explore-catalog.ts`](application/explore-catalog.ts)와
[`catalog-interactions.test.ts`](tests/catalog-interactions.test.ts)를 확인한다.
입력창은 하나지만 이름 검색은 삭제 가능한 의미 조건을 만들지 않는다. 조건은 현재
Area/Taxonomy vocabulary에서 확인되는 것만 사용하며, 미지원 문장을 이해했다고 꾸미지 않는다.

동명 장소의 거리 정렬·이어읽기 또는 명시적 분류 선택을 검토할 때는
[`persistence/README.md`](adapters/persistence/README.md)를 따른다. 거리 기준점은 정렬 힌트일 뿐
검색 반경이 아니며, 지도 이동은 목록 전체 범위를 바꾸지 않는다. 기존 v1의 의미와 커서는 유지한다.

국가·주요 도시로 이동하는 후보는 composition으로 주입되는 공개 지리 참조이며,
정확한 출처·커버리지 한계는 [Areas의 참조 설명](../areas/adapters/geographic-catalog/README.md)에 있다.
모든 주소·동네를 찾는 geocoder나 외부 지도 전체 장소 검색으로 설명하지 않는다.

```text
domain/       제출 검색·suggestion session/impression·결과·projection 값과 불변식
application/  source 조정, 선택/승격, opaque cursor, projection command, consumer-owned port
adapters/     search schema만 사용하는 PostgreSQL local/discovery source와 projection adapter
transport/    strict HTTP 요청을 제출 검색·자동완성·선택·승격 interface로 변환
tests/        cursor, partial failure, session/expiry, 선택/승격, projection 행동
```

`PostgresLocalSearch`는 `search.place_documents`와 `search.member_place_signals`만 읽고 쓴다.
다른 business schema를 조회하지 않는다. `createPlaceSearch`는 source별 continuation과
complete/partial/unavailable 결과를 하나의 bounded envelope로 합친다. 사용자용 production
composition에는 Local/Discovery Projection만 연결한다. NAVER/Kakao/Google Adapter는 수집·운영
경계에서만 사용하며 제출 검색, 자동완성, 상세 HTTP 요청에서 호출하지 않는다. coordinator는
source별 budget과 round-robin merge를 사용하므로 한 source가
결과를 독점하지 않는다. cursor는 continuation과 exhausted 상태를 감추며 실패하거나 끝난
source를 같은 continuation에서 반복 호출하지 않는다.

`LocalPlaceDocumentReader`는 Canonical Place ID 하나 또는 bounded ID batch에 대한 공개 검색
문서만 반환한다. Places 상세와 Library 목록 composition은 이 Interface를 사용하고 개인 상태는
각 소유 모듈에서 별도로 읽으므로 Search Adapter에 cross-schema join이 생기지 않는다.

외부 결과에는 canonical `placeId`를 만들지 않는다. `resultId`는 검색 선택용이고, provider가
문서화한 ID만 provider identity에 들어간다. raw 응답과 provider-specific 타입은 Providers
모듈 밖으로 나오지 않는다.

홈의 `catalog-place-search.v1`은 Local Search Projection 하나만 읽는 canonical-only Interface다.
composition이 Area와 Taxonomy 모듈의 현재 active vocabulary를 Interface로 전달하면 Search가
자연어를 결정론적으로 Area, 장소 유형, 속성, 잔여 query token으로 해석한다. 각 의미 token은
정확한 `(key, version)`에 고정되고, 제외된 token은 검색 조건에서도 빠진다. Projection은 같은
versioned reference를 저장하므로 label 문자열이나 Provider category를 검색 truth로 사용하지 않는다.
응답은 Canonical Place summary와 현재 page의 map bounds만 제공하고 legacy saved/wanted 상태는
포함하지 않는다.

`catalog-place-map.v1`은 목록 pagination과 분리된 viewport projection이다. 목록 검색과 같은
해석 Interface를 재사용하므로 Area·Taxonomy·잔여 query 의미가 갈라지지 않는다. Web Mercator
위도와 zoom을 계약에서 제한하고, `west > east`는 날짜변경선을 가로지르는 viewport로 해석한다.
넓은 범위나 feature budget을 넘는 고밀도 범위는 PostgreSQL이 최대 384개 grid cell로 집계하고,
상세 zoom에서 budget 안의 결과만 개별 Canonical Place로 반환한다. coverage의 matching 수와 모든
feature의 place 수 합계는 같은 repeatable-read snapshot에서 정확히 일치하며 임의 row limit으로
장소를 숨기지 않는다.

`PostgresPlaceSuggestions`는 10분 session, 15분 impression, 만료 가능한 Discovery 후보를 Search
schema에만 저장한다. 후보 표시만으로 Canonical Place나 SourceObservation을 만들지 않는다. 명시적
선택은 composition이 주입한 observation recorder를, 개인 기능에 필요한 승격은 주입한
materializer를 호출한다. 이 때문에 Search는 Ingestion/Places source를 역참조하지 않는다.

Web의 입력 중 자동완성과 제출 검색은 별도 상태다. 자동완성은 stale request를 취소하고 같은 session
ID를 재사용하며, 제출 검색은 기존 `place-search.v1` pagination을 그대로 사용한다. 공급자 내부
session token과 credential은 공개 suggestion 계약에 없다.

익명 검색에는 personal state가 없다. saved, wanted, visited, minimum Personal Rating 필터는
Access에서 검증한 membership ID가 있을 때만 허용한다. browser 입력의 member ID는 계약에
존재하지 않는다.
