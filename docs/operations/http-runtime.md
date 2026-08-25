# HTTP runtime

Production startup requires deployment-injected `PLACE_HTTP_HOST` and `PLACE_HTTP_PORT`; the source
contains no address default. The process owns listen, readiness, signal handling, drain, and close.
The active production composition exposes health and readiness only. Stage 2 includes source-only
`GET /v1/me` registration and browser BFF components, but neither is activated without its required
Identity and durable persistence dependencies. An operator must not substitute process memory for
login transactions or sessions when more than one instance or restart recovery is possible.
