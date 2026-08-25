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
complete/partial/unavailable 결과를 하나의 bounded envelope로 합친다. 현재 production
composition에는 local source 하나만 있고 Provider source는 Stage 6 전까지 연결하지 않는다.

익명 검색에는 personal state가 없다. saved, wanted, visited, minimum Personal Rating 필터는
Access에서 검증한 membership ID가 있을 때만 허용한다. browser 입력의 member ID는 계약에
존재하지 않는다.
