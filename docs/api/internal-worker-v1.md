# Internal worker v1

The future HTTP process submits a durable command containing opaque references, operation type,
requester authorization snapshot reference, idempotency key, and bounded parameters. It does not
send browser cookies, provider passwords, or raw profile paths.

The worker claims through a lease, records attempts and heartbeats, and writes results through
Place-owned module interfaces. Stage 1 has no job schema or claim implementation.

Stage 3 adds the in-process ingestion and canonical-resolution interfaces only. It does not publish a
worker job schema or register a claimant. A later durable job contract will carry opaque record and
decision references rather than provider payloads, browser state, or module implementation types.

## Stage 7 durable import 작업

`ingestion.import_jobs`는 cursor, available time, attempt count, lease owner·generation·expiry를
가진다. Worker는 `FOR UPDATE SKIP LOCKED`로 하나를 획득하고 세대가 일치할 때만 renew·page 기록·
attempt 종료를 수행한다. 만료 lease를 재획득하면 이전 attempt를 `lease-expired`로 닫는다.

작업 claim 내부에는 불투명 secret/profile 참조가 포함될 수 있지만 Worker 결과, HTTP, Web,
로그에는 포함하지 않는다. 인증 만료·MFA·CAPTCHA·동의·parser drift는 사용자 조치로, rate limit과
일시 장애는 상한이 있는 backoff로, checksum 불일치는 영구 실패로 분류한다.
