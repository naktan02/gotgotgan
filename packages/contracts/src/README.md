# 계약 원본

- `catalog/`: Provider-neutral 사실 assertion, 미디어 권리, Canonical Place profile 발행 계약
- `http/`: Access와 개인 콘텐츠 HTTP schema, OpenAPI operation metadata
- `search/`: `place-search.v1`, `place-taxonomy.v1` request/response schema
- `providers/`: Provider 식별 primitive
- `primitives.ts`: 계약 owner에 종속되지 않는 UUID primitive
- `place-reference/`: cross-product `place-reference.v1` schema
- `places/`: optional-member Place detail과 개인 overlay를 거부하는 public Place detail schema
- `profiles/`: 고정 Public Handle 설정과 owner identity를 제외한 public Profile/Collection directory schema
- `library/workspace.ts`: Collection-first directory·장소 검색과 동일 필터의 viewport 지도 계약.
  legacy read와 command union은 기존 `library/index.ts`에 남기고 공개 subpath는 유지한다.
- `generate.ts`: committed JSON artifact 생성 목록

이 폴더가 계약 schema의 단일 수정 지점이다. `dist/`와 publication JSON은 생성 결과다.
Imports와 Connector는 Search나 HTTP content에서 primitive를 가져오지 않고 leaf owner만 참조한다.
