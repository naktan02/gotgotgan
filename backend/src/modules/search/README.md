# Search 모듈

Search는 provider-neutral 제출 검색, 입력 중 자동완성 조정, Local/Discovery Search Projection을
소유한다.

```text
domain/       제출 검색·suggestion session/impression·결과·projection 값과 불변식
application/  source 조정, 선택/승격, opaque cursor, projection command, consumer-owned port
adapters/     search schema만 사용하는 PostgreSQL local/discovery source와 projection adapter
transport/    strict HTTP 요청을 제출 검색·자동완성·선택·승격 interface로 변환
tests/        cursor, partial failure, session/expiry, 선택/승격, projection 행동
```

`PostgresLocalSearch`는 `search.place_documents`와 `search.member_place_signals`만 읽고 쓴다.
다른 business schema를 조회하지 않는다. `createPlaceSearch`는 source별 continuation과
complete/partial/unavailable 결과를 하나의 bounded envelope로 합친다. production composition은
local source를 항상 두고, 완전한 deployment config group이 있는 NAVER/Kakao/Google 공식
source만 추가한다. coordinator는 source별 budget과 round-robin merge를 사용하므로 한 source가
결과를 독점하지 않는다. cursor는 continuation과 exhausted 상태를 감추며 실패하거나 끝난
source를 같은 continuation에서 반복 호출하지 않는다.

`LocalPlaceDocumentReader`는 Canonical Place ID 하나 또는 bounded ID batch에 대한 공개 검색
문서만 반환한다. Places 상세와 Library 목록 composition은 이 Interface를 사용하고 개인 상태는
각 소유 모듈에서 별도로 읽으므로 Search Adapter에 cross-schema join이 생기지 않는다.

외부 결과에는 canonical `placeId`를 만들지 않는다. `resultId`는 검색 선택용이고, provider가
문서화한 ID만 provider identity에 들어간다. raw 응답과 provider-specific 타입은 Providers
모듈 밖으로 나오지 않는다.

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
