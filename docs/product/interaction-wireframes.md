# Interaction wireframes

## 현재 승인된 기준 — 2026-09-05

이 절이 아래의 과거 다중 패널·햄버거 메뉴·영역 검색 버튼 설명보다 우선한다.
PC는 좁은 아이콘/이름 메뉴, 접을 수 있는 작업 패널 하나와 남은 높이 전체를 쓰는 지도다.
내 곳곳간은 목록 → 선택한 Collection의 장소 → 상세 순으로 같은 패널을 교체한다. 뒤로 가기는
검색/필터/스크롤/초점을 유지한다. 전체 저장장소 검색은 목록 화면의 명시적 동작이다.
필터는 종류 선택과 제한된 후보 검색·하위 분류 탐색을 사용한다. 음식 분류를 모두 펼치거나 없는
하위 분류를 꾸미지 않으며 후보 집계가 일부 데이터에 한정될 때 그 범위를 알린다.
모바일은 하단 메뉴를 유지하고 지도와 아래 작업 패널이 실제로 보이는 영역을 각각 확보한다.
접기는 선택을 지우지 않고 지도를 넓힌다. 현재 위치·확대축소는 오른쪽 아래에 두고 저배율 지구본
전환을 보존한다. 홈 지도 이동은 debounce로 영역 검색에 반영하되 패널/키보드 resize는 제외한다.
검색은 작업 패널에 두고 상단은 `ui-shell.md`의 고정된 금융 참조 제목/계정 구조를 따른다.

## 과거 단계 기록

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
