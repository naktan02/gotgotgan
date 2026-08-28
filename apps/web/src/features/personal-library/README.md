# Personal Library feature

사용자가 저장 상태, 저장 장소에서 파생한 지역·Taxonomy, 태그 조합, 컬렉션으로 자신의 장소를 다시 찾는 Library-first workflow다.
화면은 same-origin Browser API에만 의존하며 Backend origin, bearer token, Product Tier 이름을 알지
못한다. 선택한 장소에서는 현재 회원이 저장하거나 가져온 Collection·Tag 선택지를 페이지로 읽고
멱등 command로 기존 항목을 연결·해제한다. 전역 카테고리나 Provider/AI 자동분류는 소유하지 않는다.
같은 상세에서 저장·가고 싶음은 목표 상태로 즉시 적용하고, Personal Rating은 0.1 단위로 명시적으로
저장하거나 지운다. Place detail의 `preferencesUpdatedAt`을 예상 버전으로 보내 다른 기기의 변경을
덮어쓰지 않으며, 전송 결과를 잃은 요청은 같은 command ID로 다시 시도한다.

지역·분류 선택지는 `library-place-facets.v1`만 표시하며 count와 불완전 표본 상태도 그대로 전달한다.
화면은 지역명을 번역·병합하거나 Taxonomy를 새로 추론하지 않는다.

`personal-library-http.ts`는 versioned browser payload 해석을, 기본 workflow는 목록·상세 조정을,
preference workflow는 버전 기반 상태 변경과 안전한 재시도를, organization workflow는 선택 장소의
분류 변경을, 각 View는 접근 가능한 표현만 맡는다.
