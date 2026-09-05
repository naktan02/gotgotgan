# Place web design contract

Read the workspace design brief at `../../../plans/place-platform-ui-design-brief.md` before changing
user-visible behavior. The direction is **Calm Utility Map**: restrained surfaces, clear hierarchy,
map/workspace balance, one icon system, and density that serves repeated use.

## Approved frontend revision — 2026-09-05

The latest product decision supersedes the historical pane and header descriptions below.
The Finance user-workspace header is the visual reference, not a source dependency: keep a stable
page-title region and right-aligned theme/account region. Service search belongs in the active
working panel, never in a separately redesigned global header. Do not invent account tiers,
security facts, notifications, or active integrations when the current public contracts lack them.

Member navigation uses one icon above a small visible label. Family navigation is a labelled
launcher at the foot of that rail, consumes the existing manifest, and does not invent services.
The administrator app remains independently deployed and has no Family Services launcher.

My Library starts at the member's Collection directory, not at all saved places and not at an
automatically selected first Collection. Choosing a Collection replaces that same working panel
with its places; choosing a place replaces it with detail. Back restores search, filters, scroll,
and focus. Collapsing the panel preserves its current state and expands the map. Map workspaces
never add another parallel detail column or hide the map merely because detail is selected.

Collection search and place search have explicit, separate scopes. Large filter vocabularies use
search and bounded drill-down, with only selected values always visible. Facet counts must disclose
incomplete projection coverage; loaded list pages must never masquerade as the entire filter scope.
Place type/food classification, member-created Collections, personal tags, notes, ratings, and visits
remain distinct. Missing classification is not evidence that a place does not serve that food.

Map workspaces fill the available content height. Locate and zoom controls sit at bottom right,
globe projection remains enabled, and required data attribution stays accessible. Mobile uses one
bottom working surface with explicit map/list/detail transitions and no compressed desktop columns.

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

운영 화면은 `MapLibrePlaceMap`, 결정적 좌표·bounds interaction 검증은 test 전용
`DeterministicPlaceMap` Adapter가 담당한다. Stage 6 공식 검색 결과는 행에서 출처와 원문 링크를 표시하고,
Google 결과만 선택 후 상세·사진을 지연 조회해 provider rating과 attribution을 표시한다.
NAVER/Kakao에 없는 상세나 사진을 꾸며내지 않으며 외부 결과를 canonical Place로 보이지 않는다.
MapLibre lifecycle과 OpenFreeMap style은 feature state나 search contract를 역참조하지 않고
`platform/maps` 경계에 머문다. 4개 viewport와 상태별 screenshot을 검토했으며 세부 visual polish는 이
동작·privacy 기준을 보존하는 범위에서 계속 변경할 수 있다.

## Stage 7.14 Library workspace review

2026-08-29에 Google Maps와 NAVER Map의 현재 desktop/mobile 검색·목록·상세 흐름을 Playwright로
재검토했다. Library browse는 desktop의 `목록 -> 선택 상세 -> 지도` pane 연속성과 mobile의
`목록 | 지도` 단일 surface 및 Place 선택 후 전체 폭 상세를 채택한다. Collection은 네 번째 열이
아니라 목록 pane의 안정된 selector이며 지역·분류·Tag는 같은 pane의 filter로 남는다.

`PersonalLibraryBrowseView`는 panel transition과 focus continuity를 소유하고 기존 preference,
organization, Visit, Note workflow를 조립한다. `PersonalLibraryMap`은 Library row를 provider-neutral
marker projection으로 바꾸며 test Adapter는 Search result 계약을 요구하지 않는다. MapLibre SDK
lifecycle은 이 구조나 feature state를 바꾸지 않고 platform renderer에 남는다. 모바일에서 상세 뒤로
가기는 선택 행에 초점을 돌려주며 desktop, mobile Playwright가 이를
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
숨기며 Provider credential은 지도 Adapter에 추가하지 않는다.

후속 구조 보강에서 workflow의 넓은 반환값을 모든 panel에 전달하던 결합을 제거했다.
`search-workspace-interface.ts`가 controls/results/detail/map/layout Interface를 명시하고 각 panel은
자기 Interface만 받는다. 검색 세션 상태는 한 깊은 workflow에 남아 있으므로 일관성을 잃지 않으며,
CSS는 workspace 배치와 controls/results/detail 표현 소유로 분리됐다. provider-neutral 지도 타입도
`platform/maps` 공개 seam에 있어 test와 운영 Adapter를 교체해도 Search와 Library projection은
바뀌지 않는다. 이 보강은 화면 픽셀과 동작을 변경하지 않았다.

frontend architecture guards, 114 Web tests, typecheck, production build와 14개 Search
desktop/mobile Playwright case 및 기존 screenshot baseline이 모두 통과했다.

## Stage 6 Canonical Catalog Home

`/`는 별도 대시보드나 Provider 통합 검색이 아니라 Search가 소유한 Canonical Place projection의
주 탐색 화면이다. `CatalogHomeProvider`가 검색·선택·viewport·Collection 정리 상태를 하나의 깊은
workflow로 숨기고, shell은 상단 검색 슬롯과 전역 navigation만 소유한다. `app` 조립부가 Catalog
Home의 좁은 Library port에 Personal Library의 공개 client를 연결하므로 두 feature는 서로의 내부
component나 상태를 import하지 않는다.

화면에는 Backend가 실제로 해석한 지역·장소 유형·속성·검색어 token만 칩으로 표시한다. 사용자가
칩을 제거하거나 “이 지역에서 보기”를 누른 경우에만 해당 조건으로 다시 요청하며, 새 요청은 이전
요청을 취소한다. 지도는 별도 bounded viewport projection의 marker·cluster만 표현하고 지도 데이터나
SDK 장애가 목록과 Collection membership 생성을 막지 않는다. 즐겨찾기의 유일한 진실은 Collection membership이며 Provider
검색·상세·원문 평점은 이 workflow와 공개 BFF에 포함하지 않는다. 서비스별 저장 목록 가져오기는
설정, 원천 데이터 수집과 검수는 별도 Admin application의 책임이다.

## Stage 7.16 Canonical Place detail composition

선택한 canonical Search 결과와 Personal Library가 같은 개인 기능을 사용하되 feature끼리 내부
component를 참조하지 않는다. `PersonalPlaceDetail`은 `placeId`, 선택적 즉시 summary, 변경 callback만
받고 Place detail/auth/access/retry와 preference·organization·Visit·Note workflow를 내부에 숨긴다.
Library의 상위 workflow는 목록·filter·선택·관리만 소유한다.

Search는 canonical detail renderer Interface만 공개하고 `app/search/PlaceSearchWorkspace`가 두 feature의
공개 Interface를 조립한다. Provider 결과는 이 seam을 통과하지 않아 evidence-only 상태를 유지한다.
이 조립은 새 Backend 계약, live Provider/map 연결, Writing 범위를 추가하지 않는다. 114 Web tests,
28개 Library 및 16개 Search desktop/mobile Playwright case가 이 분리와 Provider 격리를 검증한다.

## Stage 7.17 Viewport-complete Personal Library map

Personal Library의 목록과 지도는 같은 state/Collection/Tag/지역/Taxonomy filter를 공유하지만 서로의
결과 row를 재사용하지 않는다. 목록은 cursor page, 지도는 `bounds + zoom` projection이다. 현재
viewport의 모든 projected Place는 개별 marker 또는 count-bearing cluster로 표현되며, 넓은 화면에서도
임의 row limit으로 일부 장소를 숨기지 않는다. cluster 선택은 해당 bounds로 확대하고 marker 선택은
목록 page에 없어도 기존 canonical detail을 지연 조회한다. test Adapter가 pan/zoom/cluster Interface를
검증하고 운영 MapLibre Adapter에는 Provider SDK나 credential을 연결하지 않는다.

## Stage 11C Public Collection list/map composition

공개 Collection도 목록과 지도를 하나의 큰 payload로 결합하지 않는다. server route는 첫 50개 공개
목록 page만 읽고, client experience가 opaque cursor 이어 읽기와 bounds/zoom 지도 요청을 독립적으로
조정한다. 그래서 다음 목록 page를 읽기 전에도 현재 viewport의 공개 Place가 marker/cluster에
나타난다. list row와 marker는 Place ID 선택만 공유하며 private 상세 workflow를 끌어오지 않는다.

`PublishedCollectionExperience`는 목록 pagination·viewport request·선택을 숨기는 깊은 module이고,
`PublishedCollectionPlaces`는 행 표현만 소유한다. route는 초기 데이터, app wrapper는 map Adapter를
주입한다. Search·Personal Library·publication 어느 feature도 test Adapter를 직접 import하지 않으며
운영 MapLibre 구현은 platform renderer 하나에 격리된다.

## Stage 11D Selected public Place detail

공개 Collection은 목록 제목 또는 marker를 선택하기 전에는 Place 상세를 요청하지 않는다. 선택하면
`PublishedPlaceDetail`이 loading/available/not-found/retired/unavailable 상태와 retry를 내부에 숨기고
이름·지역·분류·좌표·공개 evidence만 표시한다. 개인용 `PersonalPlaceDetail`을 재사용하지 않으므로
로그인, 저장·내 평점, 내 분류, Visit, Note workflow가 공개 화면에 우연히 포함되지 않는다.

platform publication Adapter도 Backend의 optional-member Place route를 bearer 없이 호출하고 공개 전용
schema로 응답을 좁힌다. 이 분리는 공개 화면의 시각 배치를 바꿔도 개인 상세 module이나 Backend 계약을
함께 수정하지 않게 한다.

## Stage 11E1 Public Profile composition

`PublicProfileSettings`는 인증된 설정 workflow만 소유하고 browser session이나 Backend token을 직접
다루지 않는다. platform Profile Adapter가 opaque session을 해석하고 고정 Backend route로 bearer를
전달한다. Public Handle은 첫 생성 뒤 고정되며 표시 이름과 hidden/public 상태만 optimistic version으로
바꾼다. Backend의 Handle reservation lifecycle은 이 Web workflow에 노출되지 않으며 retired Handle은
다른 unavailable Handle과 같은 conflict/not-found 경계로만 보인다.

`PublishedProfile`은 익명 projection과 Collection cursor continuation만 소유한다. Backend Profiles
module은 owner를 찾고 Library가 제공하는 좁은 public Collection directory Interface를 조합하므로
Profiles가 Library table을 읽지 않는다. 공개 HTML은 noindex/nofollow이고 `unlisted` Collection은
렌더링 입력에 들어오지 않는다. 이 panel은 향후 화면 재배치와 무관하게 전역 discovery, 팔로우, 댓글,
신고를 암묵적으로 소유하지 않는다.

## Provider import and independent detail enrichment

설정의 가져오기는 목록 제목과 각 목록의 최소 장소 정보를 검토한 뒤 내 Collection에 저장한다.
메뉴 등 상세정보의 미보유·실패는 승인 차단 사유가 아니며, 기본 근거 부족이나 연결 모호성만 별도
검토 항목으로 남긴다. 상세 보강은 현재 보류 중이라는 문구로 저장 수명주기와 구분하고 상세를
기다리는 자동 polling·미리보기 갱신을 하지 않는다. 상태 표현은 색만 사용하지 않고 문구와
`role=status`를 함께 사용한다.

## Stage 11E2B3 Owner moderation inbox composition

프로필 page는 `PublicProfileSettings`와 `PublicProfileModerationInbox`의 공개 View만 세로로 조합한다.
두 feature module은 workflow, 상태, CSS를 공유하지 않으므로 한 패널의 재배치·시각 변경이 다른 패널의
내부 구현을 요구하지 않는다. 공통 platform Profile Adapter만 session 해석, server bearer, strict
contract 검증과 고정 Backend route를 숨긴다.

검토 조회함 workflow는 bounded cursor, acknowledge와 structured appeal 재시도를 소유한다. appeal 응답이
모호하게 실패하면 같은 UUID와 payload를 보존하고 성공 뒤 projection을 다시 읽는다. View는 최신
withheld Notice에만 정해진 사유를 노출하며 reviewer 화면, 자유 서술, 첨부, email/push delivery나 사람
discovery를 포함하지 않는다.
