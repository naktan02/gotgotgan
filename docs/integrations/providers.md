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

An external result has an opaque `resultId` for UI selection and a `kind=provider` identity. Only a
resolved local record has `kind=canonical` and a canonical Place ID. Provider categories remain raw
labels until a reviewed, versioned Taxonomy mapping exists. Personal and taxonomy filters therefore
do not silently broaden official searches; those sources return a partial unsupported-filter outcome.

The shared official HTTP runner owns only redirect denial, JSON/size checks, timeout, bounded retry,
backoff, and safe failure codes. Provider request/response schemas remain in their adapters. This is
a proven three-adapter local seam, not yet a cross-project Acquisition Runtime.
