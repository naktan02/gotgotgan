# Providers

Each provider declares capabilities independently: official search, export/import, structured HTTP,
browser-assisted import, detail enrichment, or outbound save. A provider may support only a subset.

Use the least stateful method that satisfies the operation: official API/export, direct HTTP,
structured network observation, Crawlee queue, then Playwright browser interaction. Provider-specific
selectors, payloads, and session behavior remain inside `providers/adapters/<provider>`.

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

연결 목록 Import 뒤 상세 보강은 `PlaceEnrichmentSource` interface를 사용한다. Fulfillment Worker는
먼저 Canonical Provider link를 확인하고 miss일 때만 해당 Provider Adapter를 호출한다. Adapter 입력은
Provider Place ID뿐이며 회원·목록·사용자 profile은 포함하지 않는다. NAVER 실제 내부 endpoint와
서버 profile Adapter는 관찰 전 추측하지 않으며 현재 integration-gated다.
