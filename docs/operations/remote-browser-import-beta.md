# 원격 브라우저 일회성 가져오기 beta

상태: `disabled` / `integration-gated`

이 runbook은 공유 링크나 공식 export 파일로 얻을 수 없는 비공개 전체 목록을 위한 선택형 beta를
정의한다. 기본 경로는 NAVER multi-share-link batch다. 원격 session은 그 batch source 계약에 섞지
않고 별도 `Remote-browser Import Session`으로 운영한다.

## 사용자 흐름

1. 회원이 곳곳간에서 `비공개 목록 가져오기(beta)`와 보안 고지를 명시적으로 선택한다.
2. Backend가 회원·Provider·일회 operation에 결속된 짧은 view exchange code를 발급한다.
3. 별도 격리 runtime이 새 임시 browser profile을 만들고 허용된 Provider 로그인 화면만 연다.
4. 곳곳간 화면은 TLS WebSocket 위의 화면·입력 relay에 한 명의 viewer로 연결한다. 사용자는 원격
   창에서 아이디·비밀번호·MFA를 직접 입력한다. 사용자 PC의 기존 cookie·profile은 재사용하지 않는다.
5. 허용된 first-party return page에서 session을 확인한 뒤 Provider Adapter가 bounded 목록 수집을
   수행한다. CAPTCHA·보안 확인은 자동 우회하지 않고 사용자 작업 필요로 중단한다.
6. 정규화 snapshot 준비 후 browser process와 profile tmpfs를 폐기한다. 사용자는 곳곳간의 별도
   검토·승인 화면에서 Collection 반영을 결정한다.

## Runtime 경계

- 전용 `provider-session-host` process/image로 격리하고 기존 Backend Alpine image에 Chromium이나 화면
  relay를 넣지 않는다. 같은 Compose project와 공통 network 정책 안에 두되 기본 profile에서는
  생성하지 않는다.
- non-root, read-only root filesystem, tmpfs profile, 최소 seccomp/capability, no-new-privileges를
  사용한다. Docker socket, host directory, 영구 volume, database, OIDC·capture encryption secret을
  mount하지 않는다.
- egress는 선택된 Provider 로그인·목록 API와 검토된 필수 CDN host만 허용한다. loopback, RFC1918,
  link-local, metadata, 내부 DNS와 다른 Place service 접근을 차단한다.
- relay는 화면과 키보드·pointer 입력만 제공한다. raw CDP, 개발자도구, clipboard, file upload/download,
  popup, camera, microphone, geolocation, 인쇄를 제공하지 않는다. 브라우저에서 Backend로 직접 호출하는
  경로도 만들지 않는다.

초기 제한값은 exchange code 60초, idle 2분, 로그인 5분, 수집 10분, 전체 15분이다. 회원·Provider당
활성 session 1개, beta host 전체 동시 실행 1개로 시작한다. crash나 network 단절 뒤 session을
resume하지 않고 폐기한 다음 새 operation을 시작한다.

## 비밀과 기록

아이디·비밀번호·MFA 값은 DB·로그·trace·screenshot·video·console·network body에 기록하지 않는다.
다만 입력과 화면이 곳곳간 인프라를 통과하고 remote browser memory/tmpfs에는 종료 전까지 Provider
cookie가 존재한다는 사실을 동의 화면에 정확히 알린다. credential 저장, 자동 로그인, session 재사용,
장기 cookie vault는 이 beta 범위 밖이다.

운영 로그는 random session ID, 회원 내부 ID, Provider, 상태 전이, coarse item/page/byte count, 안전한
오류 code, 생성·마지막 활동·폐기 시각만 허용한다. Provider URL query, 화면 문자열, account identifier,
장소명, 메모, cookie와 response body는 기록하지 않는다. snapshot에 포함되지 않은 raw response는
session 종료 시 삭제하고, 필요한 암호화 원본의 보존 기간은 별도 정책 승인 전까지 24시간을 넘기지
않는다.

## 실패와 종료

공개 오류는 최소한 `LOGIN_REQUIRED`, `USER_CANCELLED`, `MFA_ACTION_REQUIRED`, `CAPTCHA_BLOCKED`,
`PROVIDER_RATE_LIMITED`, `PROVIDER_SCHEMA_CHANGED`, `SESSION_EXPIRED`, `RELAY_DISCONNECTED`,
`COLLECTION_LIMIT_EXCEEDED`, `CAPABILITY_DISABLED`로 분류한다. 오류 detail에 Provider body나 계정 정보를
넣지 않는다.

모든 성공·실패·취소·timeout에서 다음 순서를 지킨다.

1. 새 relay 연결과 Provider 요청을 차단한다.
2. browser process tree를 종료하고 종료 여부를 확인한다.
3. tmpfs/profile과 in-memory token을 폐기한다.
4. view code를 폐기하고 session을 terminal 상태로 만든다.
5. raw artifact deletion과 안전한 audit event를 확인한다.

누출·격리 실패·schema drift·예상 밖 host 접근·Provider 차단이 관찰되면 전역 kill switch와 Provider별
gate를 즉시 `disabled`로 바꾸고 활성 session을 모두 종료한다. 이미 승인된 snapshot과 개인 Collection
receipt는 삭제하지 않되 새 acquisition만 막는다.

## 활성화 게이트

다음 항목이 모두 충족되기 전에는 production UI에 beta를 노출하지 않는다.

- [ ] 별도 versioned remote-session 계약과 account-unknown snapshot provenance가 additive migration으로
      구현됐다. fake connection/account fingerprint를 만들지 않는다.
- [ ] exact Origin, single viewer, exchange-code replay 거부, CSRF와 WebSocket 인증을 검증했다.
- [ ] DNS rebinding을 포함한 SSRF·내부망·metadata·unexpected egress 차단을 독립 검사했다.
- [ ] synthetic login/relay tests가 timeout, disconnect, crash, cancel, duplicate start와 profile wipe를
      검증했다.
- [ ] 승인된 NAVER test account로 로그인·MFA/CAPTCHA·folder/bookmark pagination과 schema drift를 live
      검증했다. 자동 우회나 기존 개인 profile은 사용하지 않았다.
- [ ] 모바일 keyboard/IME/touch, 접근성, 느린 network와 relay reconnect 실패 UX를 확인했다.
- [ ] Provider 약관·개인정보 처리 고지·보존 정책·운영 on-call·동시성/비용 상한을 승인했다.
- [ ] share-link primary가 독립적으로 동작하며 remote failure가 공유 링크 import를 막지 않는다.

fixture와 fake host 성공은 `source-only`, 승인된 외부 Provider까지의 실제 흐름 성공만 `live-verified`로
기록한다.
