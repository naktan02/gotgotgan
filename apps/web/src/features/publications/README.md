# 공개 콘텐츠

공유 Collection은 공통 회원 셸 안의 380px 단일 작업 패널과 전체 높이 지도를 사용한다. 목록과
공개 장소 상세는 같은 패널에서 교체되며, 목록 복귀 시 스크롤·초점을 되돌린다. 접기는 선택과
viewport를 유지한다. 복귀 위치·초점은 최초 목록→상세 전환에서만 기록해 상세에서 지도 marker를
연속 선택해도 숨겨진 목록의 scrollTop으로 덮어쓰지 않는다. `tests/e2e/publications.spec.ts`는
스크롤된 목록에서 상세→marker 연속 선택→목록 복귀의 화면 위치·초점을 desktop/mobile에서 검증한다.
모바일은 지도 38%와 하단 패널 62%를 실제로 분할해 marker와 조작부를
가리지 않고, 접으면 지도가 100%로 늘어난다. 긴 소개는 접어서 읽고,
공유 Writing은 공개 본문과 연결된 장소 수만 표시하며 UUID를 장소 이름으로 표시하지 않는다.

공개 Collection/Writing page의 표현만 소유한다. 읽기 projection은 `platform/publications`, 인증된
Collection copy는 `platform/library`의 좁은 Adapter를 사용하며 Backend origin·token·membership을
알지 못한다. `PublishedCollectionActions`는 한 copy attempt를 재사용해 결과 유실 재시도에서 같은
command와 private target ID를 보존한다. 원본 공동 편집, 개인 metadata, 공개 discovery는 이 feature의
책임이 아니다.
복사 완료 링크는 `/library`의 목록 디렉터리로 이동하며 지원하지 않는 Collection 선택 query를 만들지 않는다.

`PublishedCollectionPlaces`는 정렬 위치와 공개 summary 표현만 소유한다. 이름·지역·primary
Taxonomy를 표시하고 `place: null`은 준비 중 상태로 표현하며, route와 copy workflow는 이 View의
표시 규칙을 알지 못한다.

`PublishedCollectionExperience`는 공개 Collection 읽기의 깊은 UI module이다. 초기 50개 server page,
중복을 막는 cursor 이어 읽기, 독립 viewport map 요청, list/marker 선택만 내부에서 조정한다. 초기
viewport는 장소 경도의 날짜변경선 최소 원호를 사용하고 위도를 Web Mercator 범위로 제한한다. 목록과
지도는 서로의 결과를 입력으로 쓰지 않으며 renderer 구현은 받기만 한다. route는 publication ID를
검증하고 초기 데이터를 주입하고, app wrapper가 platform map Adapter를 선택한다.

`PublishedPlaceDetail`은 선택한 Canonical Place의 익명 공개 상세만 지연 조회한다. loading, lifecycle,
retry와 공개 사실 표현을 한 Interface 뒤에 숨기고 개인 Library 상세나 인증 workflow를 import하지
않는다. 목록 제목과 marker는 같은 `placeId`를 전달하지만 상세 구현을 알지 못한다.
