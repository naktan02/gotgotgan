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

Automatic import → public catalog activation and historical backfill are **pending explicit
disclosure-policy confirmation**. The minimum publication adapter is not attached to the active
import runtime. Its versioned disclosure-policy key is not an assertion of a provider licence.
The approved-field boundary must be confirmed before connecting it; source eligibility and
provider-specific use restrictions are separate from account ownership or possession of a link.

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

No cross-provider fuzzy auto-merge is enabled. Reuse a verified provider identity; retain
independent observations when equivalence is uncertain. Similar names, nearby coordinates,
transliterations, shared brands and multiple floors are candidate evidence, not identity proof.

Before applying local migrations, retain an encrypted backup and use the
[`database lifecycle`](database-runbook.md). Compose health, synthetic browser tests, public map
tiles, signed-in personal editing and live provider imports are separate verification claims.
