# Profiles module

Profiles owns a member-controlled public identity. Its Interface hides stable Public Handle creation,
display-name and visibility updates, optimistic version checks, idempotent command replay, anonymous
publication lookup, and safe not-found behavior.

The module never reads Access or Library tables. Composition supplies a verified member ID for writes
and a `PublicCollectionDirectory` Adapter for reads. That Adapter may return only Collections whose
Library visibility is `public`; `unlisted` publications remain reachable solely by their opaque direct
link. Anonymous results never contain a membership ID or External Principal evidence.

Public profile responses are `no-store` and `noindex, nofollow`. Internal discovery, external search
indexing, reports, follows, comments, and tier quotas are not part of this slice.
