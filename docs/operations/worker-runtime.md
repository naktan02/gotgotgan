# Worker runtime

The worker is compiled from `@place/backend` but starts independently from HTTP.

Stage 7에는 durable Import store, claim/renew/fencing, bounded retry, NAVER 캡처 parser와 암호화
replay adapter가 source로 존재한다. `--check`는 `source-only` capability와 live acquisition의
`integration-gated` 상태를 출력한다. test account의 profile lifecycle과 Playwright acquisition,
artifact volume/keyring/database 설정이 검증되기 전에는 일반 startup을 허용하지 않는다.
