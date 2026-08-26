# 계약 원본

- `http/`: Access와 개인 콘텐츠 HTTP schema, OpenAPI operation metadata
- `search/`: `place-search.v1`, `place-taxonomy.v1` request/response schema
- `providers/`: Provider 식별 primitive
- `primitives.ts`: 계약 owner에 종속되지 않는 UUID primitive
- `place-reference/`: cross-product `place-reference.v1` schema
- `generate.ts`: committed JSON artifact 생성 목록

이 폴더가 계약 schema의 단일 수정 지점이다. `dist/`와 publication JSON은 생성 결과다.
Imports와 Connector는 Search나 HTTP content에서 primitive를 가져오지 않고 leaf owner만 참조한다.
