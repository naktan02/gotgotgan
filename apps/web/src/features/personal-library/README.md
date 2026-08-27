# Personal Library feature

사용자가 저장 상태, 태그 조합, 컬렉션으로 자신의 장소를 다시 찾는 Library-first workflow다.
화면은 same-origin Browser API에만 의존하며 Backend origin, bearer token, Product Tier 이름을 알지
못한다. 편집 명령은 platform BFF가 지원하지만, 장소별 Tag/Collection membership을 완전하게 읽는
projection이 생기기 전까지 이 feature는 탐색과 상세 확인만 소유한다.

`personal-library-http.ts`는 versioned browser payload 해석을, workflow는 요청 취소와 화면 상태를,
View는 접근 가능한 표현만 맡는다. 세 책임은 서로의 구현을 알지 않는다.
