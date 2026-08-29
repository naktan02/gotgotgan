# 장소 검색 기능

`search-workspace-workflow.ts`는 검색 입력과 debounce/cancellation, Taxonomy filter, cursor
pagination, suggestion session, 목록·지도 선택, bounds 재검색, Provider 상세 상태를 소유한다.
`search-workspace-interface.ts`는 이 깊은 module의 외부 Interface를 controls, results, detail, map,
layout으로 나눈다. `SearchControls.tsx`, `SearchResultListPane.tsx`, `SearchResultDetailPane.tsx`는 각각
자기 Interface만 받아 입력·후보, 결과/pagination/focus 복원, source-neutral 선택 상세를 숨기고
`SearchWorkspaceView.tsx`는 이 module과 provider-neutral map만 조립한다. 따라서 한 panel을 바꿀 때
다른 panel의 내부 상태나 동작에 의존하지 않는다. Provider 상세는
`idle/loading/available/unavailable` 판별 상태로 관리해 상세 데이터와 실패 상태가 동시에 존재하지
않는다. Backend 주소나 지도 Provider SDK는 소유하지 않고 `platform/search`, `platform/maps`의
공개 seam을 사용한다.

스타일도 `search-workspace.module.css`가 panel 배치와 mobile surface 전환만, controls/results/detail
각 CSS module이 자기 화면만 소유한다. 화면 배치를 바꿔도 검색 상태 로직을 옮기지 않고, panel
표현을 바꿔도 workspace layout 규칙을 함께 수정하지 않는 것이 이 분리의 기준이다.

`public.ts`만 상위 shell/app의 진입점이다. 내부 component를 다른 feature가 직접 import하지
않는다. 개인 filter를 추가할 때 browser가 membership ID나 authority를 만들게 하지 않는다.

Stage 6부터 결과 선택은 canonical Place ID가 아니라 source-neutral `resultId`로 동작하고 각
행은 로컬 색인 또는 공식 provider 출처를 표시한다. 원문 링크가 있으면 새 탭으로 열며,
`detailsAvailable`인 Google 결과만 선택 시 `/api/search/provider-details`를 호출한다. Provider
Rating은 Personal Rating과 섞지 않고 사진 작성자 attribution을 상세 영역에 보존한다.
Provider credential, endpoint, raw response는 feature state나 browser request에 존재하지 않는다.

Stage 7.15부터 desktop은 목록·독립 상세·지도를 조정하며 좁은 desktop은 상세이 열리면 지도를
숨긴다. mobile은 목록·지도·상세 중 하나만 보이고 상세에서 목록으로 돌아올 때 선택 행 focus를
복원한다. query, filter, bounds, pagination과 선택은 전환 중 유지되며 live SDK/Provider traffic은
활성화하지 않는다.

Stage 7.16부터 Search의 공개 Interface는 canonical 선택 상세를 그리는 renderer Interface를
선택적으로 받는다. `app/search/PlaceSearchWorkspace`가 Search와 Personal Library의 공개 Interface를
조립해 canonical `placeId`만 `PersonalPlaceDetail`에 넘긴다. Search는 Personal Library 내부 구현을
import하지 않고, Library도 Search result 계약을 알지 않는다. Provider 결과는 이 renderer를 호출하지
않고 기존 출처·원문 링크·지연 상세만 표시하므로 materialization 전에는 개인 기능으로 가장하지
않는다.
