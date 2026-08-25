# Contract and transport documentation

Machine-readable contracts live in `../../packages/contracts`; this directory explains their
semantics and evolution.

- `public-http-v1.md`: future browser/public HTTP ownership.
- `internal-worker-v1.md`: durable job behavior between HTTP and worker processes.
- `events-v1.md`: event publication rules.
- `tool-adapter-v1.md`: future AI Tool exposure.
- `errors-and-versioning.md`: compatibility and error envelopes.

Only `/healthz` and `/readyz` exist in Stage 1. Product HTTP, worker jobs, events, and Tools are not
implemented contracts yet.
