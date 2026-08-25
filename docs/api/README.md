# Contract and transport documentation

Machine-readable contracts live in `../../packages/contracts`; this directory explains their
semantics and evolution.

- `public-http-v1.md`: browser/public HTTP ownership and activation state.
- `internal-worker-v1.md`: durable job behavior between HTTP and worker processes.
- `events-v1.md`: event publication rules.
- `tool-adapter-v1.md`: future AI Tool exposure.
- `errors-and-versioning.md`: compatibility and error envelopes.

`/healthz` and `/readyz` are active lifecycle routes. The browser OIDC start, callback, and logout
handlers plus consent-gated membership onboarding exist source-only and fail closed or remain
unregistered until their dependencies are explicitly supplied. Other product HTTP, worker jobs,
events, and Tools remain unconnected unless their documents say otherwise.
