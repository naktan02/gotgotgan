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
