# Public HTTP v1

Future HTTP accepts verified Identity tokens and derives the Place member locally. Browser-supplied
member, role, tier, site, or project values are never final authorization evidence. Anonymous routes
return only public projections.

Product endpoints are added by their owning module transport and published in OpenAPI. The root HTTP
entrypoint registers them and owns lifecycle only.

`POST /v1/library/commands`, `POST /v1/visits`, and `POST /v1/writing/commands` are strict bearer-
authenticated Backend operations. They reject member, role, grade, and tier input and derive the
member through the Access composition. Library and writing command IDs are idempotent; writing
updates additionally require an expected version. `GET /v1/library/places/{placeId}` and
`GET /v1/places/{placeId}/visit-summary` return member-private projections. `GET /v1/library`,
`GET /v1/writing`, and `GET /v1/places/{placeId}/visits` provide authenticated owner views; no
equivalent anonymous route exists.

`GET /v1/public/collections/{publicationId}` and `GET /v1/public/writing/{publicationId}` are the
only Stage 4 anonymous Backend projections. The Web exposes corresponding `/api/public/...` BFF
reads and `/share/...` pages through its fixed internal Backend origin. Unknown and private
identifiers return the same safe not-found shape. Public projections never contain membership,
ratings, Visits, Tags, provenance, or revision history.

`GET /healthz` reports process liveness and does not depend on PostgreSQL, Identity, or another
process. `GET /readyz` reports 503 with a bounded `unavailable` projection when an explicitly required
dependency cannot serve traffic. Backend production readiness checks its Pool; Web production
readiness checks its OIDC Pool and internal Backend. Neither response exposes a dependency address,
credential, or exception.

The Web process owns reviewed browser-auth handlers at `GET /api/auth/oidc/start`,
`GET /api/auth/oidc/callback`, and `POST /api/auth/logout`. They delegate to the confidential BFF,
set no-store and browser hardening headers, return correlated safe problems, and never expose tokens,
provider errors, credentials, or internal endpoints. With the source-only runtime disabled, all
three return the stable `PLACE_BROWSER_AUTH_UNAVAILABLE` problem; no active Identity or Gateway flow
is implied. Logout intentionally has no GET handler.

The Web process also owns `GET /api/membership-consents/current` and
`POST /api/memberships/onboarding`. These are browser-facing BFF operations, not aliases exposed by
the backend. The consent projection is public and contains only current document/version pairs. The
onboarding operation resolves the opaque server-side session, validates the strict consent request,
and forwards its access token only over the fixed server-to-server backend client. Backend response
shapes are revalidated before a safe membership projection reaches the browser. Unexpected status,
payload, redirect, timeout, or missing runtime fails closed as a correlated problem.

`GET /v1/me` is the first authenticated contract. It returns only `membershipId`, `authorityRole`,
`userGrade`, and `productTier`; it never returns the raw principal, consent evidence, or token.
Missing/invalid evidence returns a stable 401 problem, an unmapped principal returns 403, and a
suspended or unauthorized membership returns an audited 403. The route is source-only until
production composition supplies the verifier, Place membership persistence, and audit sink.

`POST /v1/memberships/onboarding` is a source-only bearer-authenticated transport registered only
when its verifier, current consent policy, ID source, and transactional store are injected. Login
never invokes it implicitly. The strict request accepts only bounded `acceptedConsents`; principal,
Authority Role, User Grade, and Product Tier are rejected as browser input. The handler verifies the
principal, compares consent versions with server-selected current policy, and calls the single
transactional onboarding interface. It returns 201 for a new non-elevated membership, 200 for an
idempotently resolved existing membership, and safe correlated problems for malformed requests,
invalid evidence, stale consent, or unavailable persistence. Production composition, Web BFF
forwarding activation, Identity provisioning, and Gateway routing remain absent.

`GET /v1/membership-consents/current` is registered with the same optional onboarding composition.
It publishes the validated server-selected document/version set and never exposes membership
defaults or policy internals.

`PATCH /v1/administration/memberships/{membershipId}/authority-role` is registered only with the
authority-management store. It derives the acting member from bearer evidence, accepts only a UUID
path identifier and `nextRole`, and delegates all administrator/owner, stale-role, and final-owner
decisions to the access use case. Unauthorized callers receive 403 before target lookup. Outcomes
are safe projections or stable 404/409/503 problems; raw principal and audit details are excluded.

The backend production composition registers these reviewed access transports together only after
protected configuration, OIDC verifier construction, and an initial PostgreSQL readiness query
succeed. `source-only` mode registers none of them. This is deployable source, not evidence of an
active Identity client or Gateway route.
