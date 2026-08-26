# 0012: 기존 브라우저 세션을 쓰는 하나의 다중 Provider Connector를 둔다

- 상태: accepted
- 날짜: 2026-08-26

## 배경

회원이 NAVER·Kakao·Google에 이미 로그인한 상태에서 본인의 저장 목록을 Place로 가져오고, 이후에는
선택한 Place를 다시 외부 지도에 저장해야 한다. 일반 Place Web 페이지는 다른 origin의 로그인 cookie와
JSON을 자동으로 읽을 수 없다. 반면 새 Playwright persistent profile을 여는 진단 구현은 평소 브라우저의
로그인 상태를 재사용하지 못했고, 실관찰에서도 새 profile이 로그아웃 상태라 주 사용자 흐름으로 적합하지
않았다.

Provider별 확장을 각각 만들면 Place handshake, 권한, progress, 취소, upload, 브라우저 호환성,
업데이트와 보안 검토가 중복된다. 브라우저별 코드를 Provider Adapter 안에 섞으면 NAVER endpoint 변경과
Firefox/Safari runtime 변경이 서로 영향을 준다.

## 결정

1. `apps/member-connector`에 Place Connector 확장 하나를 둔다. NAVER·Kakao·Google은 별도 확장이 아니라
   같은 확장의 Provider Adapter다.
2. 확장은 설치된 현재 browser profile에서 실행한다. 가져오기마다 Provider session을 조용히 점검하고,
   만료됐을 때만 해당 Provider 로그인 탭을 열거나 포커스한다. Place는 Provider 비밀번호, cookie,
   session token, browser profile 경로를 받거나 저장하지 않는다.
3. Browser 차이는 `adapters/browser/webextensions`, Provider 차이는
   `adapters/providers/<provider>`, Place 제출 차이는 `adapters/place/capture-upload`이 소유한다.
   Extension background/content/popup과 CLI는 조립만 하는 얇은 entrypoint다.
4. Connector application은 Provider-neutral `SavedPlaceSource`, `ProviderSession`,
   `CaptureSubmission` Interface에 의존한다. folder/share ID, endpoint, schema, pagination, tab,
   permission, message, upload chunk와 retry는 각 Adapter가 숨긴다. Provider JSON 요청은 background의
   third-party cookie 전송에 의존하지 않고, exact optional permission을 받은 Provider 페이지의
   isolated world에서 same-origin으로 실행한다. Place capture 제출도 grant의 exact public origin 탭에서
   isolated world same-origin 요청으로 실행한다.
5. `packages/contracts/connector`가 Place page handshake, versioned message, progress, cancel,
   bounded capture batch, upload receipt와 error schema를 소유한다. Source code와 prose에 같은 enum을
   중복 관리하지 않고 이 계약에서 검증·생성한다.
6. Place Web/BFF는 인증된 회원 요청에 짧은 수명의 일회성 Connector grant를 발급한다. grant는 서버에서
   Identity `(issuer, subject)`, Provider, operation, Import idempotency key, expiry, nonce, 허용 item/byte/
   batch 상한과 공개 Place origin에 묶는다. 확장에 Web cookie, 장기 bearer, 임의 upload URL, private
   Backend 주소를 전달하지 않는다.
7. Provider·Place origin은 검토된 build allowlist다. Provider host permission은 사용자가 해당 Provider를
   연결하거나 가져오기를 선택했을 때 확장 소유 권한 탭을 열고, 그 탭의 Provider 버튼을 직접 누를 때만
   요청한다. Provider별 exact optional permission은 하나의 권한 레지스트리에서 관리한다. 임의 URL
   fetch나 사용자가 고른 private endpoint를 지원하지 않는다. `scripting`은 권한 레지스트리의 exact
   origin과 Provider Adapter가 고정한 요청 URL을 이중 검증한 뒤 isolated world에만 주입한다.
8. MVP에는 사용자별 서버, localhost daemon, native-messaging host가 없다. 확장을 사용할 수 없는
   모바일·브라우저와 설치 거부 사용자는 수동 JSON/file capture를 같은 Ingestion 계약으로 제출한다.
9. Playwright와 현재 전용-profile CLI는 Provider 관찰, fixture/replay, 확장 E2E, opt-in live smoke,
   통제된 fallback으로 유지한다. 일반 회원 Import의 로그인/session 소유자가 아니다.
10. 한 source tree에서 Chromium 계열과 Firefox 산출물을 만든다. Safari는 같은 application/Provider
    모듈을 재사용하되 별도 packaging/signing/live-test gate를 통과해야 지원 상태로 표시한다.
11. Manifest와 browser build에는 제한된 WXT 기술 검증을 먼저 한다. 채택해도 WXT는 바깥쪽
    build/entrypoint Adapter일 뿐이며 domain/application/Provider Adapter/connector 계약이 import하지
    않는다. exact version은 Chrome/Edge·Firefox build, permission, background/content messaging과
    결정적 E2E가 통과한 뒤 고정한다.
12. 외부 지도 저장은 별도 `SavedPlaceTarget` Interface를 사용한다. Import용 `SavedPlaceSource`에
    optional mutation method를 추가하지 않는다.

## 결과

- NAVER endpoint나 schema가 바뀌면 NAVER Adapter와 replay fixture만 수정한다.
- Firefox/Safari API나 packaging이 바뀌면 browser/build Adapter만 수정한다.
- Place upload 인증이 바뀌면 Connector 계약, capture-upload Adapter, Place BFF/Backend만 수정하며
  Provider parser는 바뀌지 않는다.
- Provider 추가에는 해당 Adapter leaf, Provider content entrypoint/manifest 등록, 설정과 fixture만
  필요하다. Ingestion, Canonical Place, Library와 Place Web의 Provider-neutral 계약은 유지한다.
- 확장은 이벤트가 있을 때만 tab/network/memory resource를 만들고 취소·완료·실패 때 명시적으로
  listener, tab, 요청과 메모리를 정리한다. 상세·사진·정규화는 서버 파이프라인이 담당한다.
- Chromium, Firefox, Safari를 한 문장으로 지원한다고 표현하지 않는다. build·설치·live 증거에 따라
  각 delivery state를 따로 기록한다.

## 대안

- Provider별 확장: Provider와 무관한 권한·handshake·upload·브라우저 호환 코드가 중복되어 제외한다.
- 사용자별 로컬 서버 또는 native host: 설치·업데이트·포트·credential·운영 책임이 커서 MVP에서
  제외한다.
- Place 서버가 Provider cookie를 받아 호출: credential 경계와 세션 철회 위험 때문에 제외한다.
- 새 Playwright profile을 일반 사용자 흐름으로 사용: 평소 로그인 상태를 재사용하지 못하므로 진단과
  fallback으로 한정한다.

## 재검토 조건

Provider가 공식 account-export/import API를 제공하거나, WebExtensions로 구현할 수 없는 필수 기능이
실제 증거로 확인되거나, native host가 필요한 대용량/OS integration 요구가 측정되거나, 별도 Connector
배포·장애·보안 소유권이 Place와 독립되어야 할 만큼 커지면 새 ADR로 경계를 재검토한다.
