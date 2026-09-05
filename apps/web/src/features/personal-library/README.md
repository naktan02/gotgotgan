# Personal Library feature

## Collection 디렉터리 우선 화면 — 2026-09-05

`/library`의 첫 화면은 전체 저장 장소가 아니라 카테고리 디렉터리다. 첫 카테고리를 자동으로
선택하지 않는다. 모든 카테고리에 걸친 검색은 디렉터리의 `모든 목록의 장소 검색`을 명시적으로
선택해야 열린다. 디렉터리 → 선택한 카테고리의 장소 → 개인 장소 상세는 같은 작업 패널에서
교체되고 뒤로 가기는 기존 검색·필터·스크롤과 선택 버튼 초점을 복원한다. 패널을 접어도 상세
편집 상태를 버리지 않으며 지도의 viewport를 유지한다. 모바일은 지도 아래의 단일 작업 표면과
전체 지도 전환을 사용한다.

카테고리 이름 검색(`collectionQuery`)과 범위 내 장소 검색(`placeQuery`)은 별도 서버 조회다.
디렉터리는 독립 cursor와 요청 취소 수명주기를 가져 장소 검색·상세 전환으로 읽은 카테고리
페이지를 잃지 않는다. 선택 범위 조회는 `includeSelectedCollection`을 명시해 디렉터리의 현재
page·검색어와 무관한 최신 카테고리 이름·revision을 받는다. 장소의 추가 검색 page가 비어 있어도
다음 cursor가 있으면 이어서 검색한다.
지도는 `personal-library-map.v2`로 같은 Collection·검색어·지역·분류·태그·평점 조건을 보낸다.
이전 v1 지도 호출처럼 Collection만 보내 필터가 누락되지 않는다.

필터는 종류 선택 → 후보 검색으로 같은 패널 안에서 좁힌다. 처음에는 최대 12개 후보만 그리고,
실제 API가 제공한 분류만 사용한다. 계층이 없는 분류 키로 음식 계층을 추측하지 않는다. API의
표본/후보 상한과 누락 가능성을 표시하며, 개인 태그는 불러온 후보 안에서 검색하고 다음 page를
명시적으로 읽는다. 후보를 화면의 장소 page에서 추출하지 않는다. 적용한 조건만 최대 3개 칩과
추가 개수로 요약한다. Missing classification은 판매하지 않는다는 판단 근거가 아니다.

## 기존 개인 기능과 계약 경계 유지

`/library`는 `CollectionLibrary`와 `personal-library-workspace.v2`를 사용한다. 장소는 현재 회원이
만든 카테고리 하나 이상에 포함될 때만 즐겨찾기이며, 별도의 저장 상태나 가고 싶은 상태를 화면,
필터, 지도 범위의 근거로 사용하지 않는다. 카테고리와 장소 cursor는 독립적으로 append한다.
지역·Taxonomy 선택지는 같은 v2 workspace의 Collection-first `availableFilters`를 사용한다. Tag 보조
요청이 실패해도 workspace 전체를 지우지 않는다.

선택한 카테고리의 공개 범위·공유 링크·장소 순서·장소 제외는
`collection-management`가 소유한다. 공개 범위는 opaque revision을 요구하는 lifecycle v2 command를,
순서와 제외는 기존 Library command 계약을 전용 same-origin client 뒤에서 사용한다. 태그 목록과
생성·이름 변경·2단계 확인 삭제는 `tag-management`가 독립적으로 읽고 변경한 뒤 workspace 필터를
갱신한다.

`place-filing/place-filing-workflow.ts`는 여러 카테고리 membership을 한 원자 command로 변경한다.
현재 읽은 페이지의 선택만 전송하고, version conflict에서는 선택을 보존한 채 최신 revision을 다시
읽는다. 응답 유실 재시도는 동일한 command ID와 payload를 사용한다. 카테고리 생성·수정·삭제도
opaque revision을 요구하는 lifecycle v2 command를 사용한다.

활성 화면은 `collection-workspace/collection-workspace.module.css`,
`place-filing/place-filing.module.css`, `personal-place-detail/personal-place-detail.module.css`처럼
소유 workflow별 CSS Module만 사용하며 이전 세대 스타일 위에 override하지 않는다. 지도는
provider-neutral `PlaceMapRenderer`로 주입되어 목록, 상세, 카테고리 filing과 독립적으로 실패할 수
있다. Personal Rating·Tag·Visit·Note는 별도 개인 기록이며 즐겨찾기 판단에는 참여하지 않는다.

## 동급 모듈과 공개 경계

직계 형제는 다음처럼 같은 추상화 수준의 하위 모듈이다.

- `collection-workspace`: 카테고리 선택·필터·장소 목록을 조립하는 화면과 workflow/client
- `collection-management`: 선택 카테고리의 공개·공유·장소 순서와 membership 제거
- `tag-management`: 개인 태그 목록·생성·이름 변경·확인 삭제
- `place-filing`: 한 장소의 여러 카테고리 membership을 원자적으로 편집하는 제어
- `library-map`: Library map projection을 provider-neutral 지도 Interface로 변환하는 Adapter
- `personal-place-detail`: 평점·태그·방문·메모를 조립하는 개인 장소 상세
- `public/index.ts`: 다른 feature와 app이 사용할 수 있는 유일한 공개 진입점

`personal-place-detail`의 `rating`, `organization`, `visits`, `notes`는 서로 다른 수명주기와
실패 복구를 가져 동급 하위 모듈로 둔다. 외부 호출자는 구현 파일을 직접 import하지 않는다. 새
workflow도 루트에 평면 파일을 추가하지 않고 가장 가까운 소유 하위 모듈에 배치한다.
`collection-workspace`는 화면 조립을 위해 leaf 모듈을 사용할 수 있지만, `collection-management`,
`tag-management`, `place-filing`, `library-map`, `personal-place-detail`은 `collection-workspace`나
서로의 내부 구현을 import하지 않는다.

검증된 비활성 v1 화면과 호환 계층은 새 구조에 보관하지 않고 제거했다. 필요한 새 기능은 기존 코드를
되살리는 대신 위의 동급 하위 모듈 중 실제 소유자에 추가한다.
