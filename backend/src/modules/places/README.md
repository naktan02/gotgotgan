# Places module

Places owns provider-independent Canonical Place identity, provider identity links, redirects,
retirement, merge/split lineage, and the composed Canonical Place detail read. Its small public
interfaces apply one typed canonical resolution command, resolve a Place/provider identity, and
read one user-facing Place projection.

Supported mutations are create, link provider identity, merge, split one provider identity, and
retire. Every attempt carries an immutable decision identity, source-decision reference, policy
version, occurrence time, and fingerprint. An identical retry is a replay; the same decision ID with
different content is a conflict.

The module does not parse provider payloads or decide whether evidence is sufficient. Ingestion owns
those decisions. Composition translates the accepted decision without either business module
importing the other's source.

`GET /v1/places/{placeId}` is public with an optional member overlay. Places resolves redirects and
owns the response orchestration, while entrypoint composition supplies a public document reader and
an authoritative personal reader. The persistence adapters for Places, Search, Library, and Visits
do not query each other's tables. An invalid optional bearer fails instead of silently falling back
to anonymous access; Product Tier names and bearer tokens never enter the detail use case.

The current `place-detail.v1` projection contains only facts already owned by Place: name, area,
coordinates, taxonomy, evidence freshness, and optional preferences/visit summary. Provider hours,
menus, photos, ratings, raw observations, and review state are not fabricated into this response.
When the public Search document is missing, anonymous reads remain retryable `503`. An authorized
member instead receives a `pending` projection containing only canonical identity and authoritative
personal state, so projection lag cannot disable personal Library, Visit, or Writing capabilities.

## Canonical Place Knowledge

계약 정렬된 `CanonicalPlaceKnowledge` Module은 Provider 원문 payload를 받지 않고 정규화된 typed fact
assertion만 기록한다. `catalog-fact-assertion-batch.v1`은 UUID `batchId`, `recordedAt`과 최대 256개
assertion을 가지며, 각 assertion은 `provider-identity` 또는 `canonical-place` subject와 UUID
`sourceObservationId`, 관찰 시각, confidence, `rightsProfileKey`를 요구한다. name, 주소, 좌표, 운영
상태, 전화, 웹사이트, 영업시간, Taxonomy, Area, Media value shape는 Catalog 계약과 동일하다.
하나의 batch에 들어가는 assertion은 동일한 subject, source observation, 관찰 시각과 rights profile을
공유하므로 서로 다른 장소나 관찰의 fact가 하나의 원자적 기록으로 섞이지 않는다. Rights profile은
명시적으로 versioned key를 사용하며, confidence는 최대 소수 셋째 자리까지만 허용되고 기록 시각은
관찰 시각보다 빠를 수 없다.

Profile publish는 required `displayName` selected fact, nullable selected facts, version-pinned Taxonomy
`primary|secondary|attribute`, Area `primary|ancestor|alternate`, Media reference, `expectedRevision`,
`policyVersion`, rationale와 완전한 evidence assertion UUID 집합을 한 번에 저장소 Port로 전달한다.
모든 non-null selected fact와 모든 Taxonomy/Area/Media Profile 항목은 `sourceAssertionId`를 필수로
가져서 publish된 값이 어느 assertion에서 선택됐는지 역추적할 수 있다.
Taxonomy와 Area는 `(key, version)` 중복 및 복수 primary를 허용하지 않고, Media reference ID도
중복될 수 없다. Evidence ID는 의미상 집합이므로 publish 전에 정렬해 fingerprint와 저장소 입력을
정규화한다.

`assertFacts`와 `publishProfile`은 Catalog payload와 분리된 trusted write context를 필수로 받는다.
Transport/auth composition이 주입한 `policy` 또는 `reviewer` actor와 bounded reference를 검증해 Store
attempt로 전달하므로, 외부 요청이 감사 주체를 위조하거나 payload에 섞을 수 없다.
Media fact는 Provider `externalUri`, 선택적 size, rights state, required attribution과 유효기간을
증거로 남긴다. Published Profile은 Media Module이 관리하는 `mediaReferenceId`와 선택적 source
assertion만 참조하며, 사용자용 `displayUri`는 Media delivery 경계에서 별도로 만든다. 결과는 Catalog 계약과 같은 `accepted`/`rejected`,
`applied`/`replayed`와 rejection code를 사용하고 현재 Profile에는 identity state, policy version과
published time이 포함된다.

Canonical identity의 `retired` lifecycle은 장소의 `permanently-closed` 운영 상태와 다른 개념이다.
따라서 read/publish 결과의 `identityState`와 Profile의 운영 상태를 별도 필드로 유지한다. PostgreSQL,
migration과 HTTP transport는 이 단계의 Interface 밖이며 후속 Adapter가
`CanonicalPlaceKnowledgeStore`를 구현한다.
