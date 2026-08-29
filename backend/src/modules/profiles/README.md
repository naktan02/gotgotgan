# Profiles module

Profiles owns a member-controlled public identity. Its Interface hides stable Public Handle creation,
display-name and visibility updates, optimistic version checks, idempotent command replay, anonymous
publication lookup, and safe not-found behavior. A separate `PublicProfileSafetyStore` Interface hides
categorized report retention, moderation concurrency, immutable decisions, and pending-queue reads;
the ordinary Profile Store does not absorb those operational responsibilities.

The module never reads Access or Library tables. Composition supplies a verified member ID for writes
and a `PublicCollectionDirectory` Adapter for reads. That Adapter may return only Collections whose
Library visibility is `public`; `unlisted` publications remain reachable solely by their opaque direct
link. Anonymous results never contain a membership ID or External Principal evidence.

Public profile responses are `no-store` and `noindex, nofollow`. Authenticated reports contain no free
text, are limited to one reporter/Handle during their 180-day retention, and never block publication
by themselves. Reviewer-or-higher moderation is independent of owner visibility; withheld and unknown
Handles share the anonymous 404 boundary. Reporter identity is never returned by the queue or public
projection. Internal discovery, external search indexing, active notification delivery, follows,
comments, and tier quotas are not part of this slice.

Owner moderation communication uses a third deep Interface, `PublicProfileAppealStore`. It hides the
owner-scoped Notice inbox, acknowledgement, one-per-decision structured Appeal, redacted operator
queue, and atomic Resolution. A pending Appeal blocks the ordinary moderation mutation. Acceptance
records both the immutable Appeal Resolution and an `appeal-accepted` moderation decision before the
current state becomes allowed; rejection leaves withheld unchanged. The inbox is not an email/push
delivery system, and no frontend or discovery surface is implied.
