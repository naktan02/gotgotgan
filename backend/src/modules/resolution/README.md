# Resolution module

Resolution answers one bounded question: which observations from different providers are plausible
representations of the same real-world place and what evidence supports that comparison?

Its public `PlaceIdentityResolver` interface accepts one provider-neutral evidence value, updates the
replaceable current comparison representation for that Provider Place Identity, selects a bounded
candidate set, and appends immutable versioned Match Assessments. It never creates a provider link,
emits an accepted Resolution Decision, or mutates a Canonical Place.

```text
domain/       raw-preserving normalization, script-aware comparison, policy and immutable values
application/  one evaluate use case and one persistence port
adapters/     Resolution-owned PostGIS candidate projection and assessment storage
tests/        multilingual, branch/floor, distance, replay and least-privilege behavior
```

Names keep their original text and optional language tag. Comparison forms are separate derived
values. Text written in disjoint scripts, such as Korean and Latin, is `unknown` similarity rather
than a mismatch. Phone, location, address, website host, category, explicit branch/floor, and
observation time remain independent features so one lossy normalized string cannot decide identity.

Candidate retrieval is bounded and uses exact phone or website-host blocks, PostGIS distance, and
`pg_trgm` name/address indexes. `likely-same` and `likely-different` are clustering/review hints.
Stage 8A does not auto-link even a high-confidence assessment.

Stage 8B adds immutable versioned Place Cluster Proposals, normalized member rows,
supporting-assessment links, unsafe-transitivity checks, and one `propose()` shadow operation behind a
small Interface. The deterministic policy processes stronger edges first but merges two groups only
when every cross-member pair is `likely-same`; missing, review, negative, or same-Provider pairs stop
the merge. Provider-specific columns and unknown detail fields do not belong in the schema. The result
returns dynamic Provider cells as a read projection.

An external web-research verifier is intentionally deferred until at least two real Provider streams
stabilize the cluster dossier. When justified, it is an injected adapter that records append-only
Cluster Verifications and cited public evidence without receiving member/session data or Canonical
mutation authority. Only composition may translate an explicitly accepted outcome into an
Ingestion-owned Resolution Decision and then call Places.
