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

Fulfillment Job도 별도 lease generation과 attempt를 소유한다. ImportItem과 pending intent는 한
transaction에서 생성되고, Worker는 Canonical cache를 Provider보다 먼저 확인한다. Canonical 또는
Library 반영 뒤 프로세스가 중단돼도 evidence ID, canonical decision ID, item ID 기반 Library command가
같은 효과를 replay한다. 처리 중 새 intent가 추가되면 현재 claim에 없던 intent를 확인해 job을 다시
`queued`로 돌리므로 요청이 유실되지 않는다. 취소된 batch의 intent는 claim 대상에서 제외하며 재개 시
명시적으로 pending으로 복원한다.

Provider Detail Job은 Fulfillment와 다른 lease generation/attempt를 사용한다. 지원 Adapter가 있는
Provider만 claim하고, 성공한 Observation/Candidate 기록은 안정 ID로 replay된다. terminal failure는
detail 상태만 `unavailable`로 바꾸며 이미 완료된 Canonical/Library 저장을 되돌리지 않는다.

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
