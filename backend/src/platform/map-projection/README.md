# Bounded map presentation

Library와 Catalog의 v3 지도에만 사용하는 business-neutral geometry/표시 경계다. Place 정체성,
회원 scope, 검색 조건, 원본 분류 해석은 소유하지 않는다. 동일 좌표라도 별개 ID를 병합 저장하지 않는다.

v2의 viewport 격자가 멀리 떨어진 소수 장소까지 합치던 문제는 `bounded-map-accumulator.test.ts`가
작은 world-pixel cell 및 100,000개 입력의 정확한 count로 재현·검증한다. 구버전 계약/집계는 유지한다.
픽셀 근접성은 Mercator world 좌표 기준이며 지구본 가장자리의 실제 화면 거리를 서버가 아는 것은 아니다.
그래서 일부 겹침을 허용하고 선택·label 충돌은 Web의 실제 `map.project` 결과로 처리한다.

회원 필터와 batch 취소를 확인할 때는 Library의 `collection-first/workspace-map.ts` 및
`tests/integration/library-queries/workspace-search-map.test.mjs`를 본다. 대량 공개 Catalog는
`search/adapters/persistence/postgres-catalog-map-v3.ts`에서 DB 집계를 유지하며
`tests/integration/catalog-map-v3.test.mjs`가 혼합 feature, 선택 scope, preview, 구버전 보존을 검증한다.

동위치 선택지는 그룹당 최대 20개이되 `bounded-map-previews.ts`에서 응답 전체 metadata도 제한한다.
남은 수는 실제 count와 일치해야 한다. `map-classification.ts`는 주입한 현재 taxonomy의 parentKey만
따르며 이름·키 구분자·공급자 원문으로 조상을 추측하지 않는다.
