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
