# Personal Library feature

## 활성 Collection-first 화면

`/library`는 `CollectionLibrary`와 `personal-library-workspace.v2`를 사용한다. 장소는 현재 회원이
만든 카테고리 하나 이상에 포함될 때만 즐겨찾기이며, 별도의 저장 상태나 가고 싶은 상태를 화면,
필터, 지도 범위의 근거로 사용하지 않는다. 카테고리와 장소 cursor는 독립적으로 append한다.
지역·Taxonomy 선택지는 같은 v2 workspace의 Collection-first `availableFilters`를 사용한다. Tag 보조
요청이 실패해도 workspace 전체를 지우지 않는다.

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
- `place-filing`: 한 장소의 여러 카테고리 membership을 원자적으로 편집하는 제어
- `library-map`: Library map projection을 provider-neutral 지도 Interface로 변환하는 Adapter
- `personal-place-detail`: 평점·태그·방문·메모를 조립하는 개인 장소 상세
- `public/index.ts`: 다른 feature와 app이 사용할 수 있는 유일한 공개 진입점

`personal-place-detail`의 `rating`, `organization`, `visits`, `notes`는 서로 다른 수명주기와
실패 복구를 가져 동급 하위 모듈로 둔다. 외부 호출자는 구현 파일을 직접 import하지 않는다. 새
workflow도 루트에 평면 파일을 추가하지 않고 가장 가까운 소유 하위 모듈에 배치한다.
`collection-workspace`는 화면 조립을 위해 세 leaf 모듈을 사용할 수 있지만, `place-filing`,
`library-map`, `personal-place-detail`은 `collection-workspace`나 서로의 내부 구현을 import하지 않는다.

검증된 비활성 v1 화면과 호환 계층은 새 구조에 보관하지 않고 제거했다. 필요한 새 기능은 기존 코드를
되살리는 대신 위의 동급 하위 모듈 중 실제 소유자에 추가한다.
