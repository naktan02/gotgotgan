# Public HTTP v1

Future HTTP accepts verified Identity tokens and derives the Place member locally. Browser-supplied
member, role, tier, site, or project values are never final authorization evidence. Anonymous routes
return only public projections.

Product endpoints are added by their owning module transport and published in OpenAPI. The root HTTP
entrypoint registers them and owns lifecycle only. Architecture validation inventories every Backend
and Web route and rejects either an undocumented source route or a stale OpenAPI operation. Every
JSON success projection is versioned; every public 4xx/5xx response uses the generated Problem
contract except readiness's bounded process-status response.

연결 계정 Import는 bearer 인증과 Place 내부 `imports.read`/`imports.write` 권한을 요구한다.
`GET /v1/provider-connections`는 안전한 메타데이터만 반환한다. `GET /v1/imports`는 optional exact
state filter와 최대 50개의 불투명 keyset page로 현재 회원의 batch 이력을 반환한다. `POST /v1/imports`는
connection UUID와 idempotency UUID만 받아 batch를 큐에 넣는다. `GET /v1/imports/{batchId}`는 원본
목록·항목 순서대로 최대 200개의 preview와 진행률을 반환하며 다음 page cursor를 제공한다.
cancel/resume은 별도 POST다. `POST /v1/import-reviews`는 command UUID, item UUID,
create/link/skip 중 하나만 받는다. member, role, cookie, profile, 캡처 본문은 받지 않는다.
브라우저는 이 Backend 주소를 직접 호출하지 않는다. Web의 동일 출처 `/api/imports...`,
`/api/import-reviews`, `/api/imports/connections` BFF가 서버 세션의 access token을 내부에서만
전달하고 request·response를 생성 계약으로 다시 검증한다. 런타임이 비활성이거나 Backend 응답이
계약을 벗어나면 안전한 correlated problem으로 fail closed한다.

Import item의 `enriching`은 안정된 Provider Place ID와 Source Snapshot을 공동 Materialization Job에서
개인 Collection에 저장 중임을 뜻한다. batch progress의 `enriching`은 이 item 수를 표시한다. Worker는
Canonical link를 재사용하거나 snapshot 근거로 create/link한 뒤 Provider 상세 요청 없이 `applied`로
바꾼다. item projection은 `sourceListId`, `sourceItemId`, `providerPlaceId`를 서로 구분하고 상세 상태를
`pending`/`available`/`unavailable`로 반환한다. cookie, profile reference, 내부 job ID와 불투명 내부
item key는 공개하지 않는다.

`POST /v1/search/places`는 익명 공개 장소 검색과 optional bearer 회원 검색을 한 계약으로
제공한다. request는 query, optional bounds, Taxonomy key filter, opaque cursor, 최대 50개 limit를
받는다. saved/wanted/visited/minimum Personal Rating filter는 검증된 membership이 없으면
401이며 member ID는 입력에 없다. response는 bounded place projection과 source별
complete/partial/unavailable outcome을 반환한다. 모든 source가 unavailable이면 안전한 503이다.
각 item의 `resultId`는 검색 선택용이고, `identity.kind=canonical`일 때만 canonical `placeId`가
있다. 외부 결과는 `identity.kind=provider`, 공급자 출처, live freshness, 문서화된 경우에만
provider Place ID와 원문 링크를 가진다.

`POST /v1/search/suggestions`와 Web의 `POST /api/search/suggestions`는 입력 중 후보를 위한 별도
`place-suggestions.v1` 계약이다. request는 query, optional opaque session UUID, bounds, area text,
language, 최대 12개 limit만 받는다. response는 같은 이름의 지점을 area/category/source로 구분하고
source별 complete/partial/unavailable을 반환한다. API key, cookie, browser profile, provider session
token, raw response는 계약에 없다. 모든 source가 실패해도 안전한 source outcome과 빈 후보를
반환하여 Web이 전체 검색 fallback을 제공할 수 있다.

`POST /v1/search/suggestion-selections`와 Web의 대응 BFF는 명시적으로 고른 후보만 replay-safe
SourceObservation으로 기록한다. `POST /v1/search/suggestion-materializations`는 bearer와
`library.write` 권한을 요구하며, save/wanted/visit/rating/note/collection/share/PlaceReference 의도가
안정된 ID를 요구할 때 Candidate와 ResolutionDecision을 거쳐 Canonical Place를 create/link한다.
browser가 member, role, evidence ID, provider credential을 지정할 수 없다. selection/materialization
reference는 session과 함께 만료되며 안전한 404로 처리한다.

`POST /v1/providers/place-details`와 Web의 `POST /api/search/provider-details`는 선택한 Google
결과에 한해 bounded 상세를 지연 조회한다. request는 provider key와 provider Place ID만 받으며
endpoint, API key, field mask는 server-side composition이 결정한다. response는 provider rating,
영업 정보, 사진 URI와 provider/사진 작성자 attribution을 허용 목록으로 반환하고 `no-store`를
사용한다. NAVER/Kakao 상세를 지원하는 척하지 않으며 안정된 unsupported problem을 반환한다.

`GET /v1/taxonomy/nodes`는 현재 active provider-neutral Node만 공개한다. Web은 고정 Backend
경로를 사용하는 `POST /api/search/places`, `POST /api/search/provider-details`,
`GET /api/search/taxonomy` BFF만 browser에 노출하고
두 방향 payload를 공유 계약으로 다시 검증한다.

`GET /v1/places/{placeId}`는 익명에게 공개 Place detail만 반환하고 optional bearer가 유효하면
Library preference와 Visits summary를 결합한다. 공개 Search 문서가 아직 없으면 익명 요청은
retryable `PLACE_DETAIL_UNAVAILABLE` 503이다. 같은 Canonical Place를 인증된 회원이 읽으면
`place-detail.v1`의 `pending` 200으로 canonical identity와 개인 상태만 반환한다. `pending`에는 이름,
좌표, Taxonomy, evidence를 넣지 않으며 Web은 기본 정보 대기와 개인 controls를 함께 표시한다.

`POST /v1/library/commands`, `POST /v1/visits`, `POST /v1/writing/commands`는 strict bearer
인증을 요구하는 Backend operation이다. member, role, grade, tier 입력을 거부하고 Access
composition에서 member를 파생한다. Library와 Writing command ID는 멱등이고 Writing 수정에는
expected version도 필요하다. Library command는 Collection 생성·이름 변경·삭제, Place
추가·이동·제거, Tag 생성·이름 변경·부착·해제·삭제를 지원한다. `GET /v1/library/places/{placeId}`와
`GET /v1/places/{placeId}/visit-summary`는 회원 private projection을 반환한다.

Library의 `set-place-preferences`는 saved/wanted/Personal Rating 전체 목표 상태와 Place detail에서
읽은 nullable `expectedUpdatedAt`을 요구한다. 같은 command ID와 payload 재전송은 `replayed`이고,
현재 preference timestamp가 예상과 다르면 값을 쓰지 않은 채 retryable
`PLACE_LIBRARY_PREFERENCE_VERSION_CONFLICT` 409를 반환한다. 클라이언트는 최신 Place detail을 다시
읽고 사용자가 원하면 새 command ID로 재적용한다. 이는 부분 toggle 재전송이나 여러 기기의 lost
update를 피한다.
`GET /v1/library/places`, `/place-facets`, `/places/{placeId}/organization`, `/collections`,
`/collections/{collectionId}`, `/tags`,
`GET /v1/writing`, `/v1/writing/{documentId}`, `GET /v1/places/{placeId}/visits`,
`GET /v1/imports`, `/v1/imports/{batchId}`는 bounded 인증 owner view이며 동등한 anonymous route는
없다. 사용되지 않던 unbounded `GET /v1/library` HTTP aggregate는 제거됐다. 각 bounded route와
내부 Library Interface가 기능별 책임을 나눠 가진다.

`GET /v1/writing`은 `kind` 외에 optional canonical `placeId`를 받아 그 Place에 연결된 owner Writing만
반환한다. opaque cursor는 kind와 Place ID 모두에 묶이며 filter가 다른 요청에서 재사용할 수 없다.
`writing.document_place_links`의 정규화 관계를 유지하고 Place-first index로 bounded 역조회를 지원한다.

`GET /v1/library/places`는 saved/wanted/rated state와 함께 반복 `tagIds` 최대 20개를 받는다.
`tagMatch=all`은 모든 Tag가 붙은 Place만, `tagMatch=any`는 하나 이상 붙은 Place를 반환한다.
Tag 이름이 바뀌어도 조회 identity와 기존 cursor 의미가 흔들리지 않도록 UUID만 filter에 사용한다.
반복 `areaKeys`와 `taxonomyKeys`도 축별 최대 10개를 받으며 축 안에서는 하나 이상, 축 사이에서는
모두 일치해야 한다. 응답 `library-place-list.v3`는 모든 정규화 filter를 되돌려주며 cursor도 그
전체 filter에 묶인다. facet filter가 있으면 한 요청에서 최대 500개의 authoritative preference를
검사하고 남은 후보가 있으면 결과가 비어 있어도 `nextCursor`를 줄 수 있다.

`GET /v1/library/place-facets`의 `library-place-facets.v1`은 현재 회원의 saved Place만 원천으로 삼는다.
최근 저장 순서로 최대 2,000개를 public Place summary와 조합하고 지역·primary Taxonomy 상위 50개씩을
count와 함께 반환한다. `coverage`는 saved/sample/projected Place 수와 전체 표본·facet 반환이 완전한지
밝힌다. 지역 key는 NFKC·공백·대소문자를 정규화한 현재 지역 표시명에서 결정적으로 만들지만 서로
다른 한글/영문 지역명을 임의로 합치지는 않는다. Taxonomy는 provider-neutral key만 identity로 쓴다.
이는 회원 데이터 기반 탐색 API이며 전역 master나 Provider/AI 자동 분류를 요구하지 않는다.

`GET /v1/library/places/{placeId}/organization`은 전역 카테고리 목록이 아니라 현재 회원이
직접 만들었거나 Provider 저장 목록에서 가져온 Collection과 Tag만 반환한다. 각 선택지는 해당
Place의 `selected` 상태를 포함하고 최대 50개씩 opaque cursor로 페이지를 나눈다. 선택되지 않은
Collection의 `position`은 `null`이며 선택된 Collection에는 실제 순서가 있다. 회원 소유권은
인증 principal에서 파생되고 다른 회원의 분류 이름이나 소속은 노출하지 않는다. Collection에
Place를 추가하는 command는 `position`을 생략할 수 있으며 이 경우 Backend가 현재 마지막 위치
뒤에 원자적으로 배치한다. 명시적 재정렬은 별도 move command가 담당한다.

Web의 Personal Library 관리 모드는 새 operation을 만들지 않고 같은 bounded Collection/Tag 조회와
`POST /v1/library/commands`를 same-origin BFF 뒤에서 조합한다. 새 Collection은 private으로 만들며,
Collection/Tag 이름 변경·삭제와 Collection Place 이동·제거는 매번 새 command ID를 사용한다. 응답을
받지 못한 동일 시도만 원래 command ID와 payload를 보존해 재전송한다. 이 operation은 Provider
즐겨찾기나 원본 목록을 수정하는 outbound sync가 아니다.

Web은 동일한 계약을 `/api/library/places`, `/api/library/place-facets`, `/api/library/collections`,
`/api/library/places/{placeId}/organization`, `/api/library/collections/{collectionId}`,
`/api/library/tags`, `/api/library/commands`와
`/api/places/{placeId}`에 다시 노출한다. 이 same-origin BFF는 opaque browser session을 서버에서
해석하고 bearer token을 browser에 반환하지 않는다. query, command, identifier, success/problem을
양방향으로 다시 검증하며 private 응답은 `no-store`다. Product Tier 정책은 BFF가 아니라 기존
Backend Product Authorizer seam에 남는다.

Web은 Visit 계약을 `GET /api/places/{placeId}/visits`와 `POST /api/visits`로도 다시 노출한다. 기록
요청은 `id`, `placeId`, `visitedAt`만 허용하며 Backend의 선택적 내부 `evidence`와 member ID는
브라우저 계약에 포함하지 않는다. 같은 장소의 반복 방문은 서로 다른 ID의 불변 occurrence이고,
응답 결과가 불명확한 동일 시도만 원래 ID와 payload로 재전송한다. history query와 응답은 Backend의
bounded cursor 계약을 그대로 검증하며 private 응답은 `no-store`다.

Web Writing은 `GET /api/writing`, `GET /api/writing/{documentId}`와
`POST /api/writing/commands`로 owner 목록·상세와 private Note mutation을 노출한다. Browser command는
create/update Note의 ID, Place, body, expected version만 허용한다. Entry, visibility, publication ID는
거부하고 server Adapter가 Backend command에 `visibility: private`을 추가한다. 적용은 `201`, 동일
command replay는 `200`, stale expected version은 retryable `409`로 보존한다. `writing-list.v2`는
서버가 정한 불변 `createdAt`과 마지막 저장 시각 `updatedAt`을 모두 반환하며, 브라우저가 두 시각을
command로 제출하거나 덮어쓸 수 없다.

`GET /v1/public/collections/{publicationId}`와 `GET /v1/public/writing/{publicationId}`는
Stage 4에서 유일한 anonymous Backend projection이다. Web은 고정된 내부 Backend origin을 통해
대응하는 `/api/public/...` BFF 조회와 `/share/...` page를 제공한다. 알 수 없는 identifier와
private identifier는 동일하고 안전한 not-found 응답을 반환한다. public projection에는
membership, Rating, Visit, Tag, provenance, revision history가 포함되지 않는다.

`GET /healthz` reports process liveness and does not depend on PostgreSQL, Identity, or another
process. `GET /readyz` reports 503 with a bounded `unavailable` projection when an explicitly required
dependency cannot serve traffic. Backend production readiness checks its Pool; Web production
readiness checks its OIDC Pool and internal Backend. Neither response exposes a dependency address,
credential, or exception. Both responses use `place-process-status.v1`.

The Web process owns reviewed browser-auth handlers at `GET /api/auth/oidc/start`,
`GET /api/auth/oidc/callback`, and `POST /api/auth/logout`. They delegate to the confidential BFF,
set no-store and browser hardening headers, return correlated safe problems, and never expose tokens,
provider errors, credentials, or internal endpoints. With the source-only runtime disabled, all
three return the stable `PLACE_BROWSER_AUTH_UNAVAILABLE` problem; no active Identity or Gateway flow
is implied. Logout intentionally has no GET handler.

The Web process also owns `GET /api/membership-consents/current` and
`POST /api/memberships/onboarding`. These are browser-facing BFF operations, not aliases exposed by
the backend. The consent projection is public and contains only current document/version pairs. The
onboarding operation resolves the opaque server-side session, validates the strict consent request,
and forwards its access token only over the fixed server-to-server backend client. Backend response
shapes are revalidated before a safe membership projection reaches the browser. Unexpected status,
payload, redirect, timeout, or missing runtime fails closed as a correlated problem.

`GET /v1/me` is the first authenticated contract. It returns only `membershipId`, `authorityRole`,
`userGrade`, and `productTier`; it never returns the raw principal, consent evidence, or token.
Missing/invalid evidence returns a stable 401 problem, an unmapped principal returns 403, and a
suspended or unauthorized membership returns an audited 403. The route is source-only until
production composition supplies the verifier, Place membership persistence, and audit sink.

`POST /v1/memberships/onboarding` is a source-only bearer-authenticated transport registered only
when its verifier, current consent policy, ID source, and transactional store are injected. Login
never invokes it implicitly. The strict request accepts only bounded `acceptedConsents`; principal,
Authority Role, User Grade, and Product Tier are rejected as browser input. The handler verifies the
principal, compares consent versions with server-selected current policy, and calls the single
transactional onboarding interface. It returns 201 for a new membership (non-elevated unless a
server-verified Platform Owner assertion is present), 200 for an
idempotently resolved existing membership, and safe correlated problems for malformed requests,
invalid evidence, stale consent, or unavailable persistence. Production composition, Web BFF
forwarding activation, Identity provisioning, and Gateway routing remain absent.

`GET /v1/membership-consents/current` is registered with the same optional onboarding composition.
It publishes the validated server-selected document/version set and never exposes membership
defaults or policy internals.

`PATCH /v1/administration/memberships/{membershipId}/authority-role` is registered only with the
authority-management store. It derives the acting member from bearer evidence, accepts only a UUID
path identifier and `member`, `reviewer`, or `administrator` as `nextRole`, and delegates stale-role
and centrally-managed-owner decisions to the access use case. Unauthorized callers receive 403 before target lookup. Outcomes
are safe projections or stable 404/409/503 problems; raw principal and audit details are excluded.

The backend production composition registers these reviewed access transports together only after
protected configuration, OIDC verifier construction, and an initial PostgreSQL readiness query
succeed. `source-only` mode registers none of them. This is deployable source, not evidence of an
active Identity client or Gateway route.
