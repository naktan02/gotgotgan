# Provider 테스트

`fixtures/`의 JSON은 설정이나 domain enum의 복사본이 아니라 외부 raw response 경계를 재생하는
redacted 계약 fixture다. parser drift와 누락 필드 처리를 공급자별로 고정하기 위해 JSON 형태를
의도적으로 유지한다.

기본 unit test는 네트워크를 사용하지 않는다. `backend/tests/provider-live-smoke.test.ts`는
`PLACE_PROVIDER_LIVE_SMOKE=1`, 검색어, 완전한 provider config group이 있을 때만 실행한다.
live smoke는 배포 승인이나 공급자 계정 활성화 증거가 아니며 blocking CI에 포함하지 않는다.
