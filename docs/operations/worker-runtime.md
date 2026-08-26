# Worker runtime

The worker is compiled from `@place/backend` but starts independently from HTTP.

Stage 7에는 durable Import store, claim/renew/fencing, bounded retry, NAVER 캡처 parser와 암호화
replay adapter가 source로 존재한다. `--check`는 `source-only` capability와 live acquisition의
`integration-gated` 상태를 출력한다. test account의 profile lifecycle과 Playwright acquisition이
검증되기 전에는 일반 acquisition startup을 허용하지 않는다.

만료 캡처 정리는 acquisition loop와 분리된 1회 명령이다.

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
