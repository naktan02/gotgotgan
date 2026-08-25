# Public HTTP v1

Future HTTP accepts verified Identity tokens and derives the Place member locally. Browser-supplied
member, role, tier, site, or project values are never final authorization evidence. Anonymous routes
return only public projections.

Product endpoints are added by their owning module transport and published in OpenAPI. The root HTTP
entrypoint registers them and owns lifecycle only.

The Web process owns reviewed browser-auth handlers at `GET /api/auth/oidc/start`,
`GET /api/auth/oidc/callback`, and `POST /api/auth/logout`. They delegate to the confidential BFF,
set no-store and browser hardening headers, return correlated safe problems, and never expose tokens,
provider errors, credentials, or internal endpoints. With the source-only runtime disabled, all
three return the stable `PLACE_BROWSER_AUTH_UNAVAILABLE` problem; no active Identity or Gateway flow
is implied. Logout intentionally has no GET handler.

`GET /v1/me` is the first authenticated contract. It returns only `membershipId`, `authorityRole`,
`userGrade`, and `productTier`; it never returns the raw principal, consent evidence, or token.
Missing/invalid evidence returns a stable 401 problem, an unmapped principal returns 403, and a
suspended or unauthorized membership returns an audited 403. The route is source-only until
production composition supplies the verifier, Place membership persistence, and audit sink.

Membership onboarding is currently an application/persistence interface rather than a public HTTP
route. Login never invokes it implicitly. A future route must verify the principal, compare the
submitted consent versions with server-selected current policy, and call the single transactional
onboarding interface without accepting authority-role input.
