# Lifecycle and failure model

HTTP owns listen, readiness, drain, and close. Worker owns job claim, lease renewal, heartbeat,
attempt recording, cancellation observation, and lease release. Browser contexts and capture handles
are opened and closed inside one claimed attempt.

Stage 1 implements only HTTP lifecycle and an explicit worker `--check`; it does not claim work.
Future failure recovery persists job and evidence state before retry. Process death must not imply
success or permit simultaneous ownership after lease expiry.

The source-only Web OIDC process composition owns pool creation, readiness, and asynchronous close.
OIDC transactions are one-time database records and sessions fail closed on expiry. The source-only
runtime deletes abandoned expired transactions and sessions in independently bounded batches of at
most 1,000 rows per table. Concurrent cleanup calls may select the same expired IDs; only one delete
succeeds and a later call continues remaining work, so cleanup is retryable and never requires UPDATE
authority.

The Node-only Next instrumentation hook owns installation before server readiness. Explicit
activation creates one process runtime, schedules non-overlapping cleanup with an unreferenced timer,
and registers SIGINT/SIGTERM close handlers. Missing activation remains a no-op and ambiguous
activation fails closed. Reviewed auth routes use this process-owned runtime. A separate fail-closed
membership lifecycle owns only its stateless backend client; the browser membership boundary reads
the two narrow interfaces without either lifecycle importing the other. Deployment activation
remains a separate gate.
