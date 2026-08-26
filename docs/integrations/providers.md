# Providers

Each provider declares capabilities independently: official search, export/import, structured HTTP,
browser-assisted import, detail enrichment, or outbound save. A provider may support only a subset.

Use the least stateful method that satisfies the operation: official API/export, direct HTTP,
structured network observation, a current-session browser extension for member-owned data, Crawlee
queue for server-owned bounded work, then Playwright diagnostics or controlled fallback.
Provider-specific selectors, payloads, and session behavior remain inside the owning provider
Adapter.

Stage 6 implements the official-search subset through deployment-injected HTTPS endpoints and
secret-file credentials:

- NAVER Local Search: search, client-side bounds filtering, source link; no documented stable Place
  ID, continuation, detail, or photo capability is claimed.
- Kakao Local keyword search: documented Place ID, rectangle and page pagination, source link; no
  separate detail or photo capability is claimed.
- Google Places API (New): Text Search token pagination and rectangle restriction; selected results
  can lazily load bounded Details and one photo URI with provider/author attribution.

입력 중 후보는 별도 provider-neutral suggestion port를 사용한다. Google은 documented Autocomplete,
Kakao는 keyword search fallback, NAVER는 Local search fallback이다. 공급자별 session/header/response
schema는 각 adapter에 남고 Web은 불투명 suggestion/session UUID만 본다. 표시 후보는 만료 가능한
Discovery Projection에만 들어가며 선택 전 Canonical Place나 공개 alias가 아니다.

An external result has an opaque `resultId` for UI selection and a `kind=provider` identity. Only a
resolved local record has `kind=canonical` and a canonical Place ID. Provider categories remain raw
labels until a reviewed, versioned Taxonomy mapping exists. Personal and taxonomy filters therefore
do not silently broaden official searches; those sources return a partial unsupported-filter outcome.

The shared official HTTP runner owns only redirect denial, JSON/size checks, timeout, bounded retry,
backoff, and safe failure codes. Provider request/response schemas remain in their adapters. This is
a proven three-adapter local seam, not yet a cross-project Acquisition Runtime.

연결 목록 Import의 Materialization Worker는 Provider Adapter를 호출하지 않고 Source Snapshot으로
Canonical Place와 private Collection을 즉시 반영한다. Provider 상세는 `(provider_key,
provider_place_id)`별 독립 상태와 후속 Adapter leaf로 분리하며 입력에 회원·목록·사용자 profile을
포함하지 않는다. NAVER 실제 상세 경로와 서버 profile Adapter는 관찰 전 추측하지 않으며 현재
integration-gated다.

회원 목록 Import의 목표 경계는 NAVER·Kakao·Google을 Adapter로 조립하는 하나의 Place Connector
확장이다. Provider `SavedPlaceSource`가 endpoint·schema·pagination·auth-expiry를 숨기고 browser
WebExtensions Adapter가 tab·permission·message 차이를 숨긴다. Provider별 확장은 만들지 않는다.
Place Web/BFF와의 제출은 `packages/contracts/connector`의 일회성 grant 계약만 사용한다. 이 확장과
NAVER 목록 수집 Adapter, exact optional permission, Web BFF, Backend grant/capture receiver와
ImportBatch 전달은 source-only로 연결됐다. 실제 Whale/NAVER session 전송은 integration-gated다.

현재 진단용 로컬 커넥터의 첫 관찰 pass는 `naver.com` 하위 응답의 method·origin·query 없는 path template·
status·content type만 기록한다. JSON body 구조는 설정에서 정확히 opt-in한 origin에만 허용하며 값은
저장하지 않는다. 발견한 origin과 키 구조를 검토해 NAVER 전용 adapter fixture가 승인되기 전까지
endpoint, selector, HTTP replay를 추가하지 않는다. 이 Place-local 한 개 adapter 증거만으로 공통
Acquisition Runtime을 추출하지 않는다.

진단용 로컬 NAVER 수집 leaf는 관찰된 current `folders/shareId`, `bookmarks/count`와 legacy
`folderList/shareID`, `bookmarkList/totalCount`를 adapter 안에서만 수용한다. folder와 bookmark를
각각 끝까지 pagination하고 별칭·memo·분류/지역 코드·시각·availability를 누락하지 않는다.
first-party 페이지 안에서 요청하므로 browser cookie/header는 밖으로 나오지 않으며 CLI는 합계만
반환한다. 전용 Playwright profile은 주 회원 session 경계가 아니며 observation·fixture/replay·E2E·
통제된 fallback으로만 유지한다. 같은 collector를 확장 NAVER Adapter도 조립하며 source list ID·이름·
목록 순서·장소 순서를 보존한다. capture submission은 Backend receiver와 실제 PostGIS까지
source-only로 검증했으며, Provider 실계정 smoke 전에는 활성 상태로 간주하지 않는다.
