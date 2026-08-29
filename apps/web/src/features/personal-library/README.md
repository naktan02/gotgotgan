# Personal Library feature

사용자가 저장 상태, 저장 장소에서 파생한 지역·Taxonomy, 태그 조합, 컬렉션으로 자신의 장소를 다시 찾는 Library-first workflow다.
화면은 same-origin Browser API에만 의존하며 Backend origin, bearer token, Product Tier 이름을 알지
못한다. 선택한 장소에서는 현재 회원이 저장하거나 가져온 Collection·Tag 선택지를 페이지로 읽고
멱등 command로 기존 항목을 연결·해제한다. 전역 카테고리나 Provider/AI 자동분류는 소유하지 않는다.
같은 상세에서 저장·가고 싶음은 목표 상태로 즉시 적용하고, Personal Rating은 0.1 단위로 명시적으로
저장하거나 지운다. Place detail의 `preferencesUpdatedAt`을 예상 버전으로 보내 다른 기기의 변경을
덮어쓰지 않으며, 전송 결과를 잃은 요청은 같은 command ID로 다시 시도한다.

`목록·태그 관리`는 탐색 화면과 분리된 전용 모드다. 새 Collection은 private으로 만들고, Collection과
Tag 이름 변경·삭제, Collection Place 위/아래 이동·제거를 기존 Library command Interface로 처리한다.
외부에는 하나의 management workflow만 보이지만 구현은 Collection, Tag, response-loss mutation
내부 seam으로 나뉜다. View는 command 조립이나 재시도 ID를 알지 못한다. 삭제와 제거는 Place 내부
정리만 바꾸며 Provider 원본 목록, 저장 preference, Place 자체를 삭제하지 않는다.

선택한 장소의 `방문 기록`은 과거 또는 현재 시각의 새 불변 occurrence를 추가하고 최신 이력을 bounded
cursor로 읽는다. 같은 장소를 다시 방문하면 이전 행을 수정하지 않고 새 ID로 기록한다. 응답 결과를
모르는 경우에만 같은 Visit ID와 payload를 재전송하며, 브라우저는 내부 evidence를 만들거나 보내지
않는다.

`내 메모`는 선택한 Place에 연결된 짧은 private Note만 다룬다. 목록은 Place에 묶인 bounded cursor로
읽고 생성·수정은 명시적 저장을 사용한다. 저장 결과를 잃으면 동일 command를 재전송하며 optimistic
version conflict에서는 작성 중인 초안을 유지하고 사용자가 최신 내용을 불러오도록 한다. 저장하지
않은 변경이 있으면 다른 Note 선택을 잠가 조용한 초안 유실을 막는다. 목록은 서버 작성일과 수정
여부를, 선택한 메모는 작성일과 마지막 수정일을 구분해 표시한다. 이 흐름에는 제목·사진 첨부·긴 글
편집기를 넣지 않는다.

지역·분류 선택지는 `library-place-facets.v1`만 표시하며 count와 불완전 표본 상태도 그대로 전달한다.
화면은 지역명을 번역·병합하거나 Taxonomy를 새로 추론하지 않는다.

Browse 화면은 desktop에서 Place 목록, 선택 상세, 지도 pane을 독립적으로 조정한다. Collection은
목록 pane 안의 selector이고 지역·분류·Tag filter와 함께 현재 목록을 만든다. mobile은 목록과 지도를
명시적으로 전환하며 Place 행이나 marker를 선택하면 전체 폭 상세로 이동한다. 목록으로 돌아갈 때
선택과 filter를 유지하고 선택 행으로 초점을 복귀시킨다. 지도에는 `PersonalLibraryMap`이 만든 최소
marker projection만 전달하며 Library workflow가 지도 SDK나 Search result 계약을 알지 않는다.

`PersonalPlaceDetail`은 canonical `placeId`와 선택적으로 즉시 표시할 summary만 받는 작은 외부
Interface다. 내부 workflow가 Place detail 요청, 교체 선택 취소, 로그인/등급/재시도 상태와 기존
preference·organization·Visit·Note workflow 조립을 소유한다. 따라서 Library의 상위 workflow는
목록·filter·선택·관리만 맡고, Search 같은 다른 app 흐름도 개인 기능을 복제하지 않고 이 Interface를
사용할 수 있다. 공개 상세에 `personalState`가 없으면 canonical 사실은 유지한 채 로그인 동작을
제시한다. 인증된 `pending` 상세는 이름·좌표를 꾸미지 않고 기본 정보 대기를 표시하되, 공개 summary
렌더링과 분리된 개인 상태·분류·방문·메모 controls는 계속 활성화한다. 상세 내용과 하위 편집기
스타일도 별도 CSS module이 소유한다.

`personal-library-http.ts`는 versioned browser payload 해석을, 기본 workflow는 목록 조정을,
preference workflow는 버전 기반 상태 변경과 안전한 재시도를, organization workflow는 선택 장소의
분류 변경을, management workflow는 Collection·Tag 수명주기와 순서를 맡는다. Browse View는 이 깊은
workflow들을 panel grammar 뒤에서 조립한다. visit workflow는 불변
기록·동일 요청 재시도·history pagination을 하나의 좁은 Interface 뒤에 두고, 각 View는 접근 가능한
표현만 맡는다. note workflow도 목록·상세·optimistic mutation을 하나의 Interface 뒤에 숨긴다.
