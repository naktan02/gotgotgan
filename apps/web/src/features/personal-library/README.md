# Personal Library feature

사용자가 저장 상태, 태그 조합, 컬렉션으로 자신의 장소를 다시 찾는 Library-first workflow다.
화면은 same-origin Browser API에만 의존하며 Backend origin, bearer token, Product Tier 이름을 알지
못한다. 선택한 장소에서는 현재 회원이 저장하거나 가져온 Collection·Tag 선택지를 페이지로 읽고
멱등 command로 기존 항목을 연결·해제한다. 전역 카테고리나 Provider/AI 자동분류는 소유하지 않는다.

`personal-library-http.ts`는 versioned browser payload 해석을, 기본 workflow는 목록 탐색을,
organization workflow는 선택 장소의 분류 변경을, View는 접근 가능한 표현만 맡는다.
