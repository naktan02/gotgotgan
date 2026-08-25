# Contract and transport documentation

Machine-readable contracts live in `../../packages/contracts`; this directory explains their
semantics and evolution.

- `public-http-v1.md`: browser/public HTTP ownership and activation state.
- `internal-worker-v1.md`: durable job behavior between HTTP and worker processes.
- `events-v1.md`: event publication rules.
- `tool-adapter-v1.md`: future AI Tool exposure.
- `errors-and-versioning.md`: compatibility and error envelopes.

`/healthz` and `/readyz` are active lifecycle routes. Browser OIDC and membership BFF handlers plus
backend current-consent, onboarding, current-membership, and authority-role transports exist
source-only. They fail closed or remain unregistered until their dependencies are explicitly
supplied. Other product HTTP, worker jobs, events, and Tools remain unconnected unless their
documents say otherwise.
