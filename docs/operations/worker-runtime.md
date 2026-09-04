# Worker runtime

The worker is compiled from `@place/backend` but starts independently from HTTP.

Stage 7에는 durable Import store, claim/renew/fencing, bounded retry, NAVER 캡처 parser와 암호화
replay adapter가 source로 존재한다. `--check`는 `source-only` capability와 live acquisition의
`integration-gated` 상태를 출력한다. test account의 profile lifecycle과 Playwright acquisition이
검증되기 전에는 일반 acquisition startup을 허용하지 않는다.

Legacy Provider Identity별 Materialization loop는 목록 item과 같은 transaction에서 만든 intent를 claim한다.
Canonical link가 있으면 재사용하고, 없으면 가져온 Source Snapshot evidence로 create/link한 뒤 여러
회원 intent를 private Collection에 멱등 반영한다. Provider 상세 Adapter나 사용자 profile은 호출하지
않는다. Compose의 `worker-import-materialization`은 이 loop를 계속 실행하고 장애 시 재시작한다.

```powershell
node backend/dist/entrypoints/worker/main.js --run-import-materialization
node backend/dist/entrypoints/worker/main.js --materialize-imported-places
```

첫 명령은 서비스용 연속 실행이고 두 번째는 기존 대기 작업 전환·운영 복구용 bounded 1회 실행이다.
둘 다 보호된 DB URL, lease, idle poll, 1회 최대 작업 수 설정만 사용한다.

승인된 v2 `TransferOperation`은 같은 backend image의 별도
`worker-transfer-materialization` 컨테이너가 처리한다. 구형 queue와 하나의 loop로 합치지 않으며
`PLACE_DATABASE_URL_FILE`과 bounded Pool 설정을 공유한다. lease 갱신용 별도 연결을 보장하기 위해
이 프로세스는 DB Pool 연결 수를 최소 2개로 요구한다. 각 loop는 승인 작업을 claim하기 전에
만료된 v2 connector import grant/capture와 outbound receipt를 먼저 정리한다. 정리가 실패하면 같은
loop에서 새 materialization을 시작하지 않는다.

```powershell
node backend/dist/entrypoints/transfer-materialization-main.js
node backend/dist/entrypoints/transfer-materialization-main.js --once
node backend/dist/entrypoints/transfer-materialization-main.js --check
```

상세 상태를 바꾸는
Provider Detail Job은 별도 Module Interface와 PostgreSQL Adapter를 사용하며 실제 PostGIS에서
검증됐다. NAVER read-only Adapter와 별도 process composition도 존재하지만 Runner/Pack artifact가
운영 image에 포함되지는 않았다. 활성화할 때는 아래 명령과 절대경로 설정을 함께 사용한다.

```powershell
node backend/dist/entrypoints/worker/main.js --process-provider-place-details
node backend/dist/entrypoints/worker/main.js --run-provider-place-details
```

필수 설정은 `PLACE_TRACEFORGE_RUNNER_FILE`, `PLACE_TRACEFORGE_RUNNER_SHA256`,
`PLACE_TRACEFORGE_NAVER_PACK_FILE`, `PLACE_TRACEFORGE_NAVER_PACK_SHA256`,
`PLACE_TRACEFORGE_NAVER_PACK_VERSION`, `PLACE_TRACEFORGE_PROFILE_ROOT`와 Worker DB 그룹이다.
lease/idle/attempt/job/retry 상한도 환경으로
제한한다. 기본 freshness는 7일이며 `PLACE_PROVIDER_DETAIL_FRESHNESS_MILLISECONDS`와
`PLACE_PROVIDER_DETAIL_REFRESH_BATCH_SIZE`로 주기와 1회 예약량을 제한한다. 실행마다
`naver-anonymous-*` 임시 profile을 만들고 종료 때 삭제한다. challenge 감지는
자동 해결이 아니라 terminal user-action 상태다.

아래 만료 캡처 정리는 v2 DB connector capture가 아니라 legacy 암호화 파일 capture를 다루며,
Materialization loop와 분리된 1회 명령이다.

```powershell
node backend/dist/entrypoints/worker/main.js --sweep-expired-captures
docker compose -f deploy/compose.yml -f deploy/compose.production.yml --profile maintenance run --rm worker-capture-sweep
```

명령은 `PLACE_DATABASE_URL_FILE`, bounded Worker Pool 설정, 절대 `PLACE_CAPTURE_ROOT`,
`PLACE_CAPTURE_KEYRING_FILE`, `PLACE_CAPTURE_MAXIMUM_BYTES`, 최대 1,000의
`PLACE_CAPTURE_SWEEP_BATCH_SIZE`를 모두 요구한다. keyring은 `place-capture-keyring.v1` 보호 JSON이며
활성 key와 canonical unpadded base64url 32-byte key만 받는다. 출력은 examined/deleted/missing/failed
건수뿐이고 secret, reference, 경로, 사용자 식별자는 포함하지 않는다. 실패 건수가 있으면 다시
실행할 수 있도록 non-zero로 종료한다. 스케줄 주기와 동시 실행 제한은 배포 운영자가 소유한다.
외부 volume은 image의 비루트 `node` 사용자만 읽고 쓰도록 배포 전에 소유권과 backup 제외 정책을
설정해야 한다. startup/DB 오류도 내부 주소나 원문 예외 대신 안정된 Worker 실패 메시지만 출력한다.
