# HTTP runtime

Production startup requires deployment-injected `PLACE_HTTP_HOST` and `PLACE_HTTP_PORT`; the source
contains no address default. The process owns listen, readiness, signal handling, drain, and close.
The active production composition exposes health and readiness only. Stage 2 includes source-only
`GET /v1/me` registration and browser BFF components, but neither is activated without its required
Identity and route dependencies. The source-only browser-auth process factory now owns bounded pool
creation, readiness, and close against encrypted PostgreSQL storage. The actual Next process must load
the database URL, OIDC client secret, and encryption key from protected files, register close/drain,
and own bounded expired-record cleanup before callback routes are activated. An operator must not
substitute process memory for login transactions or sessions.
