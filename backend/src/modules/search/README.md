# Search 모듈

Search는 provider-neutral 검색 조정과 Local Search Projection을 소유한다.

```text
domain/       검색 조건, 결과, source outcome, projection 값과 불변식
application/  검색 source 조정, opaque cursor, projection command, consumer-owned port
adapters/     search schema를 사용하는 PostgreSQL local source/projection adapter
transport/    strict HTTP 요청을 module interface로 변환하는 `/v1/search/places`
tests/        공개 interface의 cursor, partial failure, projection 행동
```

`PostgresLocalSearch`는 `search.place_documents`와 `search.member_place_signals`만 읽고 쓴다.
다른 business schema를 조회하지 않는다. `createPlaceSearch`는 source별 continuation과
complete/partial/unavailable 결과를 하나의 bounded envelope로 합친다. production composition은
local source를 항상 두고, 완전한 deployment config group이 있는 NAVER/Kakao/Google 공식
source만 추가한다. coordinator는 source별 budget과 round-robin merge를 사용하므로 한 source가
결과를 독점하지 않는다. cursor는 continuation과 exhausted 상태를 감추며 실패하거나 끝난
source를 같은 continuation에서 반복 호출하지 않는다.

외부 결과에는 canonical `placeId`를 만들지 않는다. `resultId`는 검색 선택용이고, provider가
문서화한 ID만 provider identity에 들어간다. raw 응답과 provider-specific 타입은 Providers
모듈 밖으로 나오지 않는다.

익명 검색에는 personal state가 없다. saved, wanted, visited, minimum Personal Rating 필터는
Access에서 검증한 membership ID가 있을 때만 허용한다. browser 입력의 member ID는 계약에
존재하지 않는다.
