# Areas module

Areas owns provider-neutral geographic identities and their append-only, localized hierarchy
versions. An Area is a stable filter/reference key; provider address text and map viewport labels
are evidence, not Area identities.

Versions start at 1 and form a gap-free predecessor chain. A non-country node requires the latest
active parent in the same country, so an inactive or cross-country parent cannot silently create a
broken current path.

`publishAreaNode` validates one version and delegates replay, conflict, missing-parent, and cycle
handling to the persistence port. `readAreaPath` returns the current active containment path without
exposing database rows. Places may store an exact `(areaKey, version)` assignment, but Areas never
reads Place, Search, Library, or Provider tables.

Administrative levels are deliberately not encoded as Korea-specific columns. The hierarchy uses
`country`, `administrative-area`, `locality`, `neighborhood`, and `custom`, so the same Interface can
represent Seoul, Tokyo, or provider-neutral user-facing regions.
