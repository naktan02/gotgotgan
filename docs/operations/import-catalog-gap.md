# Imported places missing from Home search

## Observation and boundary

On the local Compose runtime at `513896c` (2026-09-06), 827 Collection memberships referenced
410 canonical identities, but both current profile revisions and Search documents were empty.
Personal source fallbacks therefore displayed names/coordinates while Home could not find them.
This is an identity → current facts → derived search publication gap, not evidence that the
Collection relationships or original coordinates were lost.

The decisive recurrence probe is
[`minimum-place-catalog.test.mjs`](../../backend/tests/integration/minimum-place-catalog.test.mjs):
it separates canonical publication from Search, exercises single-connection/concurrent replay,
missing coordinates, wrong identity, private-field exclusion, and bounded projection recovery.
It runs against a disposable PostGIS database, not the user's records.

## Preservation and activation boundary

The old NAVER parser selected a member bookmark's display name before the underlying venue name.
Those historical strings cannot safely be classified as public venue names after the distinction
has been discarded. Do not manufacture a name provenance or promote a list name, note, tag,
personal rating or visit history into the shared catalog.

New server parsing preserves typed venue evidence separately from member observations. Start at
[`shared-list-source.ts`](../../backend/src/modules/providers/adapters/naver/shared-list-source.ts)
and the additive
[`migration 53`](../../backend/migrations/000053_preserve_provider_listed_facts.ts).
Legacy NULL evidence remains unknown; this migration does not publish or rewrite historical data.

ADR 0026은 versioned source-eligibility 정책을 통과한 Provider 원본 장소 사실에 한해 가져오기에서
공통 카탈로그로 자동 기여하는 것을 승인한다. Transfer materialization runtime은
[`provider-listed-place-contribution.ts`](../../backend/src/entrypoints/catalog/provider-listed-place-contribution.ts)의
좁은 port를 통해 구조화된 `providerListedFacts`만 최소 Profile·alias·Search에 기여하고, 성공한 뒤에만
개인 membership 단계로 진행한다. disclosure-policy key는 Provider 이용 허가를 주장하는 값이 아니다.
Provider·획득 방식별 저장·표시 제한은 계정 소유나 링크 보유 여부와 별개인 fail-closed 활성 조건으로
유지한다.

Current public facts and personal observations remain distinct read sources. For detail and
Library composition, use
[`library-place-summaries.ts`](../../backend/src/entrypoints/catalog/library-place-summaries.ts).
It preserves exact taxonomy versions and does not depend on a completed detail-enrichment job.
Frozen detail contracts already allowed null coordinates; only the narrower Backend DTO needed
alignment. Never substitute zero coordinates or an address for an area identity.

## Recovery and limits

[`minimum-place-publication.ts`](../../backend/src/entrypoints/catalog/minimum-place-publication.ts)
uses the existing append-only canonical change feed. Its repair operation is deliberately limited
to minimum-profile policy records; it skips richer profiles rather than indexing incomplete
classification/area data as a current canonical revision. A full rich-profile projector remains
separate work. The runtime DB role still cannot directly overwrite canonical coordinates.

Later eligible Provider observations add immutable assertions and searchable aliases. They create a
new minimum-policy Profile revision only when they fill a missing address or location; a later name
does not silently replace the selected display name. Re-projecting the same current revision is
allowed so newly eligible aliases repair Search without inventing another Profile revision.

The historical 410 identities still have no structured `source_snapshot_items` evidence from which
provider-listed names can be distinguished from personal display aliases. Therefore this change does
not backfill those records. Recovery remains gated on allowed Provider revalidation plus an encrypted,
restore-verified environment backup; unknown strings stay in the personal fallback.

No cross-provider fuzzy auto-merge is enabled. Reuse a verified provider identity; retain
independent observations when equivalence is uncertain. Similar names, nearby coordinates,
transliterations, shared brands and multiple floors are candidate evidence, not identity proof.

Before applying local migrations, retain an encrypted backup and use the
[`database lifecycle`](database-runbook.md). Compose health, synthetic browser tests, public map
tiles, signed-in personal editing and live provider imports are separate verification claims.
