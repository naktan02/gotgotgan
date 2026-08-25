# Public HTTP v1

Future HTTP accepts verified Identity tokens and derives the Place member locally. Browser-supplied
member, role, tier, site, or project values are never final authorization evidence. Anonymous routes
return only public projections.

Product endpoints are added by their owning module transport and published in OpenAPI. The root HTTP
entrypoint registers them and owns lifecycle only.

`GET /v1/me` is the first authenticated contract. It returns only `membershipId`, `authorityRole`,
and `productTier`; it never returns the raw principal or token. Missing/invalid evidence returns a
stable 401 problem, an unmapped principal returns 403, and a suspended or unauthorized membership
returns an audited 403. The route is source-only until production composition supplies the verifier,
Place membership persistence, and audit sink.
