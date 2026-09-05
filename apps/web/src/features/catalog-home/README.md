# Catalog Home

The Home feature searches only the provider-neutral Canonical Place catalog through
`/api/search/catalog`. It does not expose live NAVER, Google, or Kakao search results.

즐겨찾기는 회원 소유 Collection으로 표현하며 검색 결과를 Collection에 정리한다. Collection 요약과
최근 활동은 홈에 상시 배치하지 않고 회원 목록 화면에서 다룬다. 장소 좌표가 없거나 주입한 지도
renderer가 실패해도 검색 목록과 Collection 선택기는 계속 사용할 수 있다.

2026-09-05 개편은 검색을 380px 작업 패널 안에 둔다. 검색 결과와 선택 장소는 같은 패널을 교체하고,
뒤로 가기는 목록의 행 초점과 스크롤을 복원한다. 패널을 접어도 검색 상태는 보존한다. 모바일은
작업 패널 위에 지도를 유지하고 패널을 접으면 지도에 가용 공간 전체를 준다. 필터 후보는 요청할
때만 검색 가능한 제한된 목록으로 열며 세부 음식명은 임의 taxonomy가 아닌 검색어로 다룬다.
실제 지도 이동은 300ms 후 교체 검색하지만 레이아웃·키보드·패널 크기 변화는 지역 검색 의도가
아니다. 전역 헤더 검색과 영역 재검색 버튼은 제거했다.

지도에만 있는 장소의 최소 summary에는 검증 상태가 없으므로 로컬 `unknown`으로 구분하고 검증
배지를 생략한다. 공개 검색·지도 계약을 바꾸거나 `unverified` 사실을 만들지 않는다. 선택 summary와
Collection 선택기 상태는 viewport 교체 조회 중에도 유지하며, 클러스터 확대도 같은 bounds의 목록·지도
조회 경로를 사용한다. 이전에는 marker 초기화·첫 페이지 교체로 선택이 유실되고 클러스터 확대가
지도만 갱신했다. `CatalogHome.test.tsx`와 `tests/e2e/search.spec.ts`가 배지 비노출, map-only 선택의
요청 중·완료 후 보존, 클러스터 list/map bounds 일치를 재검증한다.

목록의 복귀 행과 스크롤은 최초 목록→상세 전환 때만 저장한다. 상세에서 다른 지도 마커를 연속
선택해도 이 값을 덮어쓰지 않는다. 이전에는 같은 패널의 상세 스크롤과 현재 마커가 복귀 대상을
바꿨다. 위 E2E의 20개 결과 fixture가 1440·1280·390·360px에서 원래 행 초점·스크롤 복원을 검증한다.
