# Public HTTP v1

Future HTTP accepts verified Identity tokens and derives the Place member locally. Browser-supplied
member, role, tier, site, or project values are never final authorization evidence. Anonymous routes
return only public projections.

Product endpoints are added by their owning module transport and published in OpenAPI. The root HTTP
entrypoint registers them and owns lifecycle only.

`POST /v1/library/commands`, `POST /v1/visits`, `POST /v1/writing/commands`는 strict bearer
인증을 요구하는 Backend operation이다. member, role, grade, tier 입력을 거부하고 Access
composition에서 member를 파생한다. Library와 Writing command ID는 멱등이고 Writing 수정에는
expected version도 필요하다. `GET /v1/library/places/{placeId}`와
`GET /v1/places/{placeId}/visit-summary`는 회원 private projection을 반환한다.
`GET /v1/library`, `GET /v1/writing`, `GET /v1/places/{placeId}/visits`는 인증된 owner view이며
동등한 anonymous route는 없다.

`GET /v1/public/collections/{publicationId}`와 `GET /v1/public/writing/{publicationId}`는
Stage 4에서 유일한 anonymous Backend projection이다. Web은 고정된 내부 Backend origin을 통해
대응하는 `/api/public/...` BFF 조회와 `/share/...` page를 제공한다. 알 수 없는 identifier와
private identifier는 동일하고 안전한 not-found 응답을 반환한다. public projection에는
membership, Rating, Visit, Tag, provenance, revision history가 포함되지 않는다.

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
