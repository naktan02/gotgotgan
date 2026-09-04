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

Provider Detail Worker의 현재 실행 계약은 `provider_key`와 `provider_place_id`만 Runner recipe
입력으로 전달한다. 회원·ImportBatch·Source List·cookie·login 정보는 전달하지 않는다. 성공 응답은
공개 상세 snapshot으로 검증한 뒤 checksum과 parser version을 포함한 새 Source Observation으로
기록한다. `challenge-required`는 CAPTCHA를 해결하는 명령이 아니라 중단 상태다.

Worker 시작과 continuous idle 주기는 `PLACE_PROVIDER_DETAIL_FRESHNESS_MILLISECONDS`보다 오래된
`available` identity를 최대 `PLACE_PROVIDER_DETAIL_REFRESH_BATCH_SIZE`개씩 새 Job으로 예약한다.
기존 Job과 Observation은 수정하지 않는다. 새 상세 관찰은 이전 정상 관찰 ID와 change kind를 보존한다.

캡처 만료 정리는 Import claim과 별도인 유지보수 명령이다. 만료 메타데이터만 bounded batch로
선택하고 암호화 artifact를 삭제한 후 `deleted_at`을 기록한다. 개별 실패는 수량으로만 보고하며
secret/profile/capture reference를 출력하지 않는다. 이 명령은 Provider 브라우저나 profile을 열지
않고 acquisition lease를 대신하지 않는다.
