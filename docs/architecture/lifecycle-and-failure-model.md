# Lifecycle and failure model

HTTP owns listen, readiness, drain, and close. Worker owns job claim, lease renewal, heartbeat,
attempt recording, cancellation observation, and lease release. Browser contexts and capture handles
are opened and closed inside one claimed attempt.

Stage 1 implements only HTTP lifecycle and an explicit worker `--check`; it does not claim work.
Future failure recovery persists job and evidence state before retry. Process death must not imply
success or permit simultaneous ownership after lease expiry.
