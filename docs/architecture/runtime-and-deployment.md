# Runtime and deployment

The HTTP server is an always-available interactive runtime. The acquisition worker is a separate
process from the same backend build and may be continuous, scheduled, or on demand. Process scaling
does not change module ownership.

The source-only runtime exposes local health/readiness scaffolds and the Stage 2 shell/access code.
Gateway, Identity, database, provider, map,
family navigation, and AI delivery states remain `not-integrated` or `integration-gated` as routed in
the workspace plan.

One digest-pinned multi-stage Dockerfile produces separate `web-runtime` and `backend-runtime`
targets. The worker uses the backend image with a different command. Compose requires every host and
port from deployment configuration and activates the worker scaffold only in a verification profile.
