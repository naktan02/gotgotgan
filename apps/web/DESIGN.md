# Place web design contract

Read the workspace design brief at `../../../plans/place-platform-ui-design-brief.md` before changing
user-visible behavior. The direction is **Calm Utility Map**: restrained surfaces, clear hierarchy,
map/workspace balance, one icon system, and density that serves repeated use.

## Ownership

```text
app      -> shells, features, domains, platform, shared
shells   -> features, domains, platform, shared
features -> domains, platform, shared
domains  -> platform, shared
platform -> shared
shared   -> no upper layer
```

Platform siblings also require an explicit direction. Membership may consume auth session
resolution; auth cannot import membership. Architecture validation rejects every undeclared
platform-sibling import so process composition cannot silently create reverse dependencies.

Routes adapt Next.js only. Shells own top/left/mobile composition. Features own user workflows.
Domains own reusable Place representations. Platform owns auth, HTTP, maps, telemetry, and manifest
SDKs. Shared owns only proved business-neutral primitives.

## Current limits

The current shell is a structural and accessibility baseline, not the final visual design. Keep it
free of fake place cards, fake provider data, decorative gradients, and hard-coded family services.
Desktop and mobile browser tests own the initial screenshots.

Authentication belongs to `platform/auth` as a deep browser-BFF boundary. Membership browser/backend
translation belongs to `platform/membership` with separate activation. Routes only adapt Next.js
requests and responses; features and shells never receive access tokens, refresh tokens, nonce,
state, PKCE verifier, or an internal backend origin.

## Stage 5 검토 결과

로컬 검색은 desktop에서 균형 잡힌 목록/지도 작업 공간을, mobile에서 명시적인 목록/지도
전환을 사용한다. 검색 입력은 debounce와 이전 요청 취소를 소유하고, 지도 이동은 자동 검색이
아니라 사용자의 “이 영역 검색” 동작으로 확정한다. partial, loading, empty, error 상태는 결과와
분리해 읽을 수 있어야 하며 새 검색의 실패가 이전 pagination이나 source 경고를 남겨서는 안 된다.

현재 `DeterministicPlaceMap`은 실제 좌표·bounds interaction을 검증하는 renderer adapter이다.
live tile은 연결되지 않았다. Stage 6 공식 검색 결과는 행에서 출처와 원문 링크를 표시하고,
Google 결과만 선택 후 상세·사진을 지연 조회해 provider rating과 attribution을 표시한다.
NAVER/Kakao에 없는 상세나 사진을 꾸며내지 않으며 외부 결과를 canonical Place로 보이지 않는다.
향후 live map adapter는 feature state나 search contract를 역참조하게 만들지 않고 `platform/maps`
경계에서 교체한다. 4개 viewport와 상태별 screenshot을 검토했으며 세부 visual polish는 이
동작·privacy 기준을 보존하는 범위에서 계속 변경할 수 있다.

## Stage 7.14 Library workspace review

2026-08-29에 Google Maps와 NAVER Map의 현재 desktop/mobile 검색·목록·상세 흐름을 Playwright로
재검토했다. Library browse는 desktop의 `목록 -> 선택 상세 -> 지도` pane 연속성과 mobile의
`목록 | 지도` 단일 surface 및 Place 선택 후 전체 폭 상세를 채택한다. Collection은 네 번째 열이
아니라 목록 pane의 안정된 selector이며 지역·분류·Tag는 같은 pane의 filter로 남는다.

`PersonalLibraryBrowseView`는 panel transition과 focus continuity를 소유하고 기존 preference,
organization, Visit, Note workflow를 조립한다. `PersonalLibraryMap`은 Library row를 provider-neutral
marker projection으로 바꾸며, `DeterministicPlaceMap`은 더 이상 Search result 계약을 요구하지 않는다.
따라서 live NAVER map SDK는 이 구조나 feature state를 바꾸지 않고 platform renderer에서 교체할 수
있다. 모바일에서 상세 뒤로 가기는 선택 행에 초점을 돌려주며 desktop, mobile Playwright가 이를
검증한다.

## Stage 7.15 Search workspace alignment

Search는 Library와 같은 desktop `목록 -> 선택 상세 -> 지도` 흐름을 사용하되 검색 고유 상태를
유지한다. 검색 입력/자동완성, 결과 목록, 선택 상세는 각각 깊은 module이고 `SearchWorkspaceView`는
이들과 provider-neutral map renderer만 조립한다. 선택 상세는 더 이상 목록 안의 floating card가
아니며 source identity, evidence, coordinates, Provider 원문 링크와 선택 시 지연 조회된 상세·사진
attribution을 한 연속 surface에서 보여준다.

mobile은 목록과 지도를 명시적으로 전환하고 결과나 marker 선택 시 전체 폭 상세로 이동한다. 상세
뒤로 가기는 query, Taxonomy, bounds, pagination, 선택을 유지하고 선택 행으로 focus를 복원한다.
desktop close만 선택을 해제해 지도 공간을 다시 넓힌다. 1180px 이하 desktop은 상세가 열릴 때 map을
숨기며, live map SDK, Provider credential 또는 새로운 Backend 계약은 추가하지 않는다.

후속 구조 보강에서 workflow의 넓은 반환값을 모든 panel에 전달하던 결합을 제거했다.
`search-workspace-interface.ts`가 controls/results/detail/map/layout Interface를 명시하고 각 panel은
자기 Interface만 받는다. 검색 세션 상태는 한 깊은 workflow에 남아 있으므로 일관성을 잃지 않으며,
CSS는 workspace 배치와 controls/results/detail 표현 소유로 분리됐다. provider-neutral 지도 타입도
`platform/maps/place-map-interface.ts`에 있어 deterministic renderer를 live renderer로 교체해도
Search와 Library projection은 바뀌지 않는다. 이 보강은 화면 픽셀과 동작을 변경하지 않았다.

frontend architecture guards, 114 Web tests, typecheck, production build와 14개 Search
desktop/mobile Playwright case 및 기존 screenshot baseline이 모두 통과했다.

## Stage 7.16 Canonical Place detail composition

선택한 canonical Search 결과와 Personal Library가 같은 개인 기능을 사용하되 feature끼리 내부
component를 참조하지 않는다. `PersonalPlaceDetail`은 `placeId`, 선택적 즉시 summary, 변경 callback만
받고 Place detail/auth/access/retry와 preference·organization·Visit·Note workflow를 내부에 숨긴다.
Library의 상위 workflow는 목록·filter·선택·관리만 소유한다.

Search는 canonical detail renderer Interface만 공개하고 `app/search/PlaceSearchWorkspace`가 두 feature의
공개 Interface를 조립한다. Provider 결과는 이 seam을 통과하지 않아 evidence-only 상태를 유지한다.
이 조립은 새 Backend 계약, live Provider/map 연결, Writing 범위를 추가하지 않는다. 114 Web tests,
28개 Library 및 16개 Search desktop/mobile Playwright case가 이 분리와 Provider 격리를 검증한다.
