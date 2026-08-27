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
