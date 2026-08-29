# Interaction wireframes

The recommended initial desktop shape is a balanced list/map workspace. A map-plus-work-drawer and a
library-first arrangement remain alternatives for provider acquisition and dense personal curation.

Stage 5 검토 결과 첫 검색 화면은 검색·분류 control 아래에 목록과 지도를 균형 있게 나누는
구조로 확정했다. 목록 선택은 지도 marker와 연결하고, 지도 이동은 자동 요청이 아니라 명시적인
“이 영역 검색”으로 반영한다. provider detail/photo가 없는 로컬 결과에 가짜 이미지나 평점을
만들지 않는다.

Mobile uses a top bar and hamburger-owned side navigation; feature content chooses list, detail, or
map focus rather than shrinking a desktop split view. These are structural options, not frozen pixels.

mobile에서는 목록과 지도를 동시에 축소하지 않고 명시적인 전환 control로 한 화면씩 보여준다.
상단 product shell과 hamburger-owned navigation 규칙은 유지한다. 세부 색상·간격·카드 표현은
후속 iteration에서 바꿀 수 있지만 이 interaction 계약은 E2E가 소유한다.

개인 Library browse는 Stage 7.14부터 desktop에서 하나의 Place 목록 pane 안에 상태, Collection,
지역·분류·Tag filter를 두고, 독립된 선택 상세 pane과 지도를 나란히 조정한다. Collection을 별도
열로 유지해 `Collection + 목록 + 상세 + 지도` 네 영역을 모두 축소하지 않는다. 좁은 desktop에서는
선택 상세가 열릴 때 지도를 숨기고 상세 닫기로 지도 공간을 되찾는다. `목록·태그 관리`는 지도와
경쟁하지 않는 별도 library-first surface를 유지한다.

mobile에서는 목록과 지도를 명시적으로 전환하고 Place 선택 시 전체 폭 상세로 이동한다. 목록으로
돌아가면 query/filter/선택을 유지하고 선택 행에 초점을 복귀시킨다. 상세는 내 상태, 정보, 내 분류,
반복 방문, body-only private Note를 한 연속 panel에서 제공한다. 이 구조는 탐색·초점 계약이며 시각
표현과 향후 live map renderer는 교체 가능하다.
