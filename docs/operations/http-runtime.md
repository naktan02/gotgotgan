# HTTP runtime

Production startup requires deployment-injected `PLACE_HTTP_HOST` and `PLACE_HTTP_PORT`; the source
contains no address default. The process owns listen, readiness, signal handling, drain, and close.
Stage 1 exposes health and readiness only.
