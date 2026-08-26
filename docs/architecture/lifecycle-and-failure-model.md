# Lifecycle and failure model

HTTP owns listen, readiness, drain, and close. Worker owns job claim, lease renewal, heartbeat,
attempt recording, cancellation observation, and lease release. Browser contexts and capture handles
are opened and closed inside one claimed attempt.

Stage 7의 Import Worker use case는 claim/renew/fencing과 attempt 결과를 DB에 먼저 남긴다. 하지만
실제 Provider profile composition은 아직 연결하지 않아 실행 entrypoint의 live acquisition은
fail-closed다. 별도 capture expiry 명령은 DB Pool과 encrypted file store를 한 실행 안에서 생성하고
성공·실패 모두에서 닫는다. 파일 삭제 뒤 DB 표식이 실패하면 다음 sweep이 missing artifact를
멱등 처리하고 표식을 재시도한다. Process death must not imply success or permit simultaneous
ownership after lease expiry.

Backend `source-only` mode owns Fastify only. Backend `production` mode validates all configuration,
constructs the verifier, connects one bounded Pool, and performs an initial query before becoming
ready. Startup failure closes the Pool. Runtime readiness repeats a minimal query and sanitizes
failure; liveness stays independent. Shutdown closes Fastify before the Pool and is idempotent.

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

An application deployment unit binds Web and Backend images to one exact source revision. Rollback
must name the current and target immutable units, preserves the database, and never reverses a
migration automatically. Local source builds cannot become production image inputs without separate
published-digest, SBOM, provenance, and smoke evidence.
