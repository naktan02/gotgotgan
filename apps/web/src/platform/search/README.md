# 검색 Web 경계

브라우저는 같은 origin의 검색 BFF만 호출한다. 이 platform owner는 고정된 Backend
경로로 익명 공개 검색과 Taxonomy 조회를 전달하고, 공유 계약으로 요청·응답을 다시 검증한다.
Backend 주소, member ID, bearer token, 내부 오류는 브라우저 payload에 포함하지 않는다.

`browser-search-http.ts`가 JSON 요청 검증, Backend 오류 allowlist, problem 응답과 보안·cache
header를 한 번에 소유한다. Next route는 Request를 이 interface에 위임하는 transport Adapter다.

브라우저의 큰 분류·세부 음식 탐색을 붙일 때는 `taxonomy-picker/public.ts`를 사용한다.
실제 projection의 `parentKey`만 따라가며 빈 projection은 준비 중으로 남긴다.
호출자는 선택 label과 projection의 원래 key를 검색 workflow에 전달한다. label에서 식별자를
추측하지 않으며 동명이 분류라도 선택한 key를 보존한다.
분류 이름 선택은 상위 전체 선택이고 별도 화살표는 하위 탐색이다. 이름 검색은 보조 수단으로
접어 두며 첫 후보 수를 제한한다. 같은 계층의 중복 상위 칩 제거는 Backend v2 해석이 소유한다.
지리 확장 탐색의 versioned BFF는 `catalog-interactions-http.ts`와 해당 테스트에서 확인한다.
