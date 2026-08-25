# Lifecycle and failure model

HTTP owns listen, readiness, drain, and close. Worker owns job claim, lease renewal, heartbeat,
attempt recording, cancellation observation, and lease release. Browser contexts and capture handles
are opened and closed inside one claimed attempt.

Stage 1 implements only HTTP lifecycle and an explicit worker `--check`; it does not claim work.
Future failure recovery persists job and evidence state before retry. Process death must not imply
success or permit simultaneous ownership after lease expiry.

The source-only Web OIDC process composition owns pool creation, readiness, and asynchronous close.
OIDC transactions are one-time database records and sessions fail closed on expiry. Bounded cleanup
for abandoned expired records and installation into the actual Next process remain activation gates.
