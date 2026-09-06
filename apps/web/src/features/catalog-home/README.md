# Catalog Home

홈은 곳곳간의 공개 내부 카탈로그를 검색한다. 외부 지도 전체를 실시간 조회하거나 개인 가져오기
별명을 공개 사실로 승격하지 않는다. 제품 의도는 [DESIGN](../../../DESIGN.md)을 따른다.

## 검색과 탐색 경계

- 검색 대상은 전체 장소/즐겨찾기 두 가지다. 즐겨찾기 내부에서 저장 전체/특정 Collection을 고른다.
  앱 조립은 [CatalogHomeApplication](../../app/CatalogHomeApplication.tsx)과
  [Library 진입](../../app/library/PlaceLibraryWorkspace.tsx)에서 확인한다.
- 입력 중 이름 후보/지리 후보/조건 해석의 선택은
  [CatalogSearchInput](search-input/CatalogSearchInput.tsx)에 있다. 원입력은 유지하고,
  이름을 일괄 × 칩으로 바꾸지 않는다. 조건은 실제 vocabulary만 사용한다.
- 국가/주요 도시의 이동용 참조는 주소 전체 geocoder가 아니다.
  [지리 자료 범위](../../../../../backend/src/modules/areas/adapters/geographic-catalog/README.md)를 확인한다.
- 명시적 검색의 목록 범위는 지도 이동으로 좁아지지 않는다. 지도는 같은 검색 의미의 viewport
  projection만 갱신한다. 해당 요청 순서와 페이지 커서는
  [workflow](catalog-home-workflow.tsx) 및 [browser client](catalog-home-client.ts)가 소유한다.
- 검색 결과와 상세는 한 패널을 교체하며 뒤로 가기는 최초 행·스크롤을 복원한다. 패널 접기는
  상태를 지우지 않는다. 모바일은 접힘/중간/확장으로 지도와 목록의 공간을 조절한다.

## 재발 확인

초기 URL 또는 빠른 Enter의 늦은 해석이 같은 문자의 명시적 이름 선택까지 덮던 요청 소유권 문제는
[의도 순서 회귀](search-input/catalog-query-intent.test.ts)에서 지연 응답으로 검사한다.
[브라우저 회귀](../../../../../tests/e2e/search.spec.ts)는 빠른 Enter로 국가 이동, 이름 후보 선택,
조건 제거, 지도 이동 후 전체 목록 유지, Collection 정리 및 네 폭에서의 복귀·접기를 검사한다.
[실제 지도 회귀](../../platform/maps/testing/camera-roundtrip/run.mjs)는 별도의 SDK 카메라 검사다.
Fixture 검색 결과는 외부 공급자 연동이나 실제 공개 카탈로그의 데이터 보유량을 증명하지 않는다.
