# 회원 로컬 커넥터

`member-connector`는 회원 기기에서 실행하는 곳곳간 소유 Connector 경계다. 확장 프로그램을 필수로
두지 않으며 NAVER·Kakao·Google의 검증된 API·DOM·명시적 캡처 전략과 실행 호스트를 각각 Adapter로
분리한다. 캡처는 짧은 수명의 일회성 곳곳간 grant로만 제출하며 Provider cookie·token·profile 경로를
서버로 보내지 않는다.

현재는 provider-neutral application 경계, 선택형 WebExtensions browser Adapter, NAVER API Provider Adapter,
v2 immutable snapshot·승인 기반 export coordinator, WXT entrypoint와 Chromium·Firefox build 검증을
source-only로 구현했다. Backend v2 receiver와 실행 control-plane, 회원 session 전용 grant BFF는
존재하지만 Connector capability BFF와 v2 page bridge는 아직 조립되지 않았다. 비추출 AES-GCM key를
주입받는 암호화 snapshot spool, durable outbound
attempt spool, 암호화 reconciliation vault와 v2 HTTP Adapter는 source-only로 구현했지만 WebExtension
storage만으로 재시작 가능한 안전한 key 보관을 증명하지 못했다. 또한 검증된 account fingerprint
Adapter, 전용 Connector origin, 실제 Provider write Adapter가 없다. 따라서 어떤 실행 호스트도 제거된
v1 capture 경로로 우회하지 않고 현재 지원 Provider를 빈 목록으로 알린다. production 실행 호스트
채택과 로그인된 NAVER session 검증은 `integration-gated`다.

전용 Playwright profile을 쓰는 기존 로그인·비식별 네트워크 관찰·NAVER 전체 저장 목록 bounded
수집기는 진단 CLI로 남아 있다. 실관찰에서 평소 브라우저의 로그인 상태를 재사용하지 못했으므로 주
회원 Import 경로로 사용하지 않고 진단·fixture/replay·E2E·통제된 fallback에만 쓴다.

## 구현 구조

사용하지 않는 Kakao·Google·DOM·OCR leaf는 미리 만들지 않고 첫 동작 capability와 fixture가 생길 때
생성한다. 현재 Connector 경로는 다음과 같다.

```text
src/
  application/
    collect-saved-library.ts    pagination·상한·batch·checksum·receipt를 숨기는 깊은 Interface
    import-snapshot/            v2 local seal·grant 재발급·resume·명시적 complete
      index.ts                  외부 caller와 Adapter가 사용하는 유일한 import seam
      workflow.ts               phase 순서만 고정하는 얇은 orchestration
      collection.ts             Provider collect·normalize·immutable seal
      handoff.ts                grant 검증·resume·upload·complete
      model.ts                  runtime 입력·결과·오류·binding 검증
      commitment.ts             UTF-8 byte·SHA-256 commitment
      ports/                    snapshot/fingerprint/normalizer 동급 경계
    outbound-export/            승인 기반 외부 저장을 한 Interface 뒤에 숨기는 deep module
      index.ts                  runtime과 안정된 입력·결과 type만 공개하는 seam
      ports/                    target/control/spool/vault 동급 경계
      authorization.ts          approved plan·grant·receipt의 exact binding
      attempt-journal.ts        local seal·Backend intent·보고·bounded crash recovery
      target-list-execution.ts  새 Provider 목록 생성 phase
      item-batch-execution.ts   승인 manifest의 add batch 실행 phase
      reconciliation.ts        unknown outcome 관측·해결·retention 완료
      runtime.ts                위 순서를 바꿀 수 없게 조립하는 실행 Interface
    connector-transfer-runtime.ts  import/export deep module을 활성화하는 상위 조립
    handle-connector-command.ts Place command와 작업 lifecycle 조립
    ports/
      saved-place-source.ts
      provider-session.ts
      capture-submission.ts
  adapters/
    browser/webextensions/     tab·message·permission·cancel·resource close
      transfer-storage/        versioned AEAD snapshot/attempt/vault Adapter
    providers/naver/
      api/                     내부 JSON session·folder/bookmark schema·전체 pagination
      snapshot/                v2 snapshot 정규화
    place/capture-upload/      공개 BFF와 일회성 Connector grant만
    place/transfer-control/    분리된 member-session/capability v2 HTTP Adapter
  entrypoints/
    extension/                 WXT가 읽는 얇은 composition entrypoint
      background.ts
      place-bridge.content.ts
      popup/
  acquisition/                 기존 NAVER/Playwright 진단 수집 leaf
  observation/                 기존 비식별 관찰 application·Adapter
tests/fixtures/                 결정적 extension build 설정
```

Provider `SavedPlaceSource`가 folder/share ID, endpoint, schema와 pagination을 숨기고 browser Adapter가
브라우저 차이를 숨긴다. Place `CaptureSubmission`은 chunk, retry, idempotency와 grant를 숨긴다.
Stage 10의 외부 저장은 별도 `SavedPlaceTarget`을 사용하며 Import source에 optional mutation을 붙이지
않는다. Import v2는 Provider별 normalizer 뒤의 payload를 private local spool에 immutable chunk로 먼저
seal하고, operation·connection·Provider·계정 fingerprint·installation·manifest에 결속된 짧은 grant를
그 다음 발급받는다. grant command는 spool identity가 아니므로 응답 유실이나 만료 후 새 command로
재발급해 같은 manifest의 서버 prefix부터 재개할 수 있다. 서버의 명시적 complete receipt 전에는
Source Snapshot 완료로 취급하지 않는다.

계정 fingerprint Port는 raw 계정 ID를 반환하지 않고 installation private key와 domain separator로
만든 keyed SHA-256 값만 허용한다. 현재 NAVER session Adapter가 신뢰할 수 있는 계정 identity를
관측하지 못하므로 실제 fingerprint Adapter는 만들지 않았고 capability를 닫았다. grant token과
execution receipt token은 JSON document나 Provider Target에 전달하지 않고
`OutboundExecutionControl`의 별도 인자로만 넘겨 PlaceConnector Authorization header에 둔다.
Export coordinator는 exact approved plan과 Backend one-time authorization receipt를 검증한 뒤에만
Target command를 만들며, manifest의 `already-present` 항목은 digest에는 남기되 Provider 쓰기와
consume 수량에서는 제외한다. runtime composition은 durable local seal, Backend intent 승인, Provider
호출과 결과 보고 순서를 한 경계에서 고정한다. 다만 `available` target capability와 실제 transport,
durable spool, secure vault, Backend control을 모두 제공한 Provider만 등록할 수 있다. 현재 production
catalog는 NAVER `integration-gated`, Google·Kakao `unavailable`이며 실제 Provider write Adapter는 없다.
자세한 결정은
[`../../docs/adr/0024-make-member-acquisition-host-neutral.md`](../../docs/adr/0024-make-member-acquisition-host-neutral.md)를 따른다.

`outbound-export/index.ts`가 이 module의 유일한 공개 Interface다. 승인, 실행 phase, journal/recovery,
reconciliation 파일은 같은 실행 수명주기의 내부 역할이며 다른 application workflow가 직접 import하지
않는다. 새 Provider는 이 구조를 복제하지 않고 `SavedPlaceTarget` Adapter를 추가한다. 새 실행 phase가
생기면 기존 파일을 비대하게 만들기 전에 독립된 상태 전이와 변경 이유가 있는지 검토하고, 그렇다면
`outbound-export/` 아래 동급 phase module로 둔다. generic `utils`·`common` 폴더나 얇은 전달 wrapper는
만들지 않는다.

Export Provider 호출 순서는 `local seal → Backend prepareAttempt recorded/replayed → local prepared
ack → Provider command`로 고정된다. attempt UUID와 opaque reconciliation reference가 두 durable
경계에 모두 기록되기 전에는 Provider command 자체가 노출되지 않는다. Provider 관측 결과는 Backend
ack 뒤 `reported`가 되고, terminal 결과나 resolved reconciliation만 `completed`와 `retainUntil`을
기록한다. unknown 결과는 `reported`에 남아 재조정 외 재실행을 허용하지 않는다. 재시작 시 bounded
pending scan은 `sealed`와 `prepared` 두 crash point를 Provider 재호출 없이 outcome-unknown으로
보고한다. completed 기록은 retention 전 삭제할 수 없다.

실행 receipt의 write TTL은 Provider mutation과 일반 결과 보고에만 쓰고, 더 긴 reconciliation TTL은
secure vault에서 재수화한 뒤 unknown 결과 보고·조회에만 쓴다. vault는 OS credential store 또는
authenticated encryption을 사용하고 expiry 후 secret을 제거해야 한다. receipt token은 control-plane
Authorization 인자로만 전달되며 spool, Target command, Provider payload, 일반 로그에 직렬화하지 않는다.
현재 authenticated-encryption Adapter는 외부에서 안전하게 provision한 non-extractable key만 받으며
key material을 storage에 쓰지 않는다. 새 key로 재시작하거나 ciphertext가 손상되면 복구를 시도하지
않고 fail closed한다. 브라우저 storage에 key와 ciphertext를 함께 넣는 우회는 구현하지 않았다.

HTTP Adapter도 두 채널을 섞지 않는다. 회원 session이 필요한 grant 발급은 정확한 Place BFF origin의
고정 경로 하나만 허용하고 Connector token을 금지한다. Capture·attempt·reconciliation capability는
Place Service Worker가 Authorization을 볼 수 있는 isolated-world BFF fetch를 사용하지 않는다. 별도
HTTPS Connector origin과 서버가 검증할 정확한 `chrome-extension://` 또는 `moz-extension://` Origin이
모두 주입될 때만 cookie 없는 직접 채널로 조립할 수 있다. 현재 이 origin contract와 host permission이
없으므로 HTTP Adapter는 production background에 등록되지 않는다.

`application/ports`에는 여러 workflow가 함께 사용하는 legacy/browser-neutral Port만 남긴다. Import와
Outbound 전용 Port는 각각의 deep module 아래에 두고 외부 caller는 `index.ts`만 import한다. 운영 파일
500줄, 폴더 직계 운영 파일 12개, `common`·`helpers`·`misc`·`utils` 폴더 금지는
`npm run check:architecture --workspace @place/member-connector`가 검사한다.

## 확장 산출물과 브라우저 상태

WXT `0.21.4`와 Vite `6.4.3`을 고정했다. Chrome·Edge·Whale은 Chromium Manifest V3 산출물 하나를
공유하고 Firefox는 별도 Manifest V3 산출물을 만든다. Whale 전용 코드를 복제하지 않으며 browser
감지는 Whale을 Chrome보다 먼저 판별한다. Safari는 아직 산출물이 없다.

현재 manifest의 기본 권한은 `scripting`, `storage`이고 Place content bridge에는 빌드 시 주입한 정확한
공개 origin 하나만 사용한다. 아직 비활성인 v2 capability transport용 Connector origin은 manifest에
없다. `scripting`은 기존 진단/legacy seam과 사용자가 선택 권한을 부여한 Provider 페이지의 same-origin
JSON 요청에만 사용한다. NAVER는
`https://pages.map.naver.com/*`를 optional host permission으로 둔다. Place에서 가져오기를 선택했을 때
권한이 없으면 확장 소유 권한 탭을 열고, 사용자가 해당 Provider 버튼을 직접 눌렀을 때만 요청한다.
실제 배포 산출물은 다음처럼 만든다.

```powershell
$env:WXT_PLACE_CONNECTOR_PUBLIC_ORIGIN='https://<public-place-origin>'
npm run build:extension:chromium --workspace @place/member-connector

$env:WXT_PLACE_CONNECTOR_FIREFOX_ID='<reviewed-firefox-extension-id>'
npm run build:extension:firefox --workspace @place/member-connector
```

저장소 검증은 reserved `.invalid` origin과 test-only Firefox ID를 사용한다.

```powershell
npm run check:extension --workspace @place/member-connector
```

이 검증은 Chromium/Firefox build, manifest 상한, NAVER exact optional permission을 확인한다. 가짜
확장 E2E는 Place page handshake·permission·progress·completion을 desktop/mobile에서 검증한다. 실제
Chrome·Edge·Whale·Firefox 설치와 NAVER session, Backend receipt는 별도 live 검증이 필요하다. 특히
Whale은 Chromium 산출물 호환 구조만 검증했으며 실설치 smoke 전까지 `integration-gated`다. 상세 계약은
[`../../docs/api/connector-v1.md`](../../docs/api/connector-v1.md)를 따른다.

NAVER collector의 current `folderList/shareID/bookmarkList`와 legacy
`folders/shareId/bookmarks` 변화는 개인값을 제거한 독립 JSON fixture로 같은 결과를 재생한다. 이
fixture는 이미 허용한 parser 변화의 회귀 증거이며 새로운 live endpoint나 schema 관찰을 뜻하지 않는다.

## 현재 진단 CLI 폴더 의미

```text
src/
  acquisition/
    adapters/playwright/  first-party 페이지 안의 credential-including JSON fetch와 context 수명주기
    tests/                응답 크기·종료와 진단 조립 테스트
  adapters/providers/naver/api/
    saved-place-collector.ts  실행 호스트들이 공유하는 schema·pagination leaf
  observation/
    application/   응답 값을 버리고 origin·경로 틀·JSON 키/타입만 만드는 use case와 port
    adapters/
      playwright/  보이는 Chrome, 전용 persistent context, timeout·취소·종료 수명주기
      filesystem/  저장소 밖 private 관찰 보고서의 생성 전용 저장
    tests/          application·Playwright·filesystem 경계 테스트
  entrypoints/cli/  환경 설정 검증과 위 구성요소를 조립하는 로컬 명령
```

`application`은 `adapters`나 `entrypoints`를 import할 수 없다. 커넥터는 다른 Place workspace
패키지나 저장소 밖 소스를 import할 수 없고, 이 규칙은 저장소 아키텍처 검사로 고정한다.

## 로그인과 관찰

먼저 저장소 밖의 전용 프로필 절대 경로와 NAVER URL을 주입해 로그인 창을 연다. 로그인·2차
인증은 사용자가 Provider 창에서 직접 수행하고 완료 후 창을 닫는다.

```powershell
$env:PLACE_MEMBER_CONNECTOR_PROFILE_ROOT='<absolute-private-profile-directory>'
$env:PLACE_NAVER_MEMBER_URL='https://map.naver.com/'
npm run member-connector:login:naver
```

로그인 명령에는 response listener, trace, screenshot, 요청 body 수집이 없다. 평소 사용하는 Chrome
프로필을 지정하지 않는다.

관찰은 별도 명령이다. `PLACE_NAVER_OBSERVATION_ORIGINS`는 JSON body의 구조를 읽어도 되는 정확한
origin의 쉼표 구분 목록이다. 처음에는 화면 origin 하나만 허용한다. 커넥터는 다른 `naver.com`
하위 origin의 method·origin·query 없는 경로 틀·status·content type만 기록하므로, 그 보고서를
검토한 뒤 필요한 origin만 명시적으로 추가할 수 있다.

```powershell
$env:PLACE_MEMBER_CONNECTOR_PROFILE_ROOT='<absolute-private-profile-directory>'
$env:PLACE_MEMBER_CONNECTOR_REPORT_ROOT='<absolute-private-report-directory>'
$env:PLACE_NAVER_MEMBER_URL='https://map.naver.com/'
$env:PLACE_NAVER_OBSERVATION_ORIGINS='https://map.naver.com'
$env:PLACE_MEMBER_CONNECTOR_OBSERVATION_MILLISECONDS='120000'
$env:PLACE_MEMBER_CONNECTOR_MAXIMUM_BODY_BYTES='65536'
npm run member-connector:observe:naver
```

관찰 보고서는 지정한 private 디렉터리에 UUID 파일명과 생성 전용 쓰기로 저장된다. query,
response 값, cookie, header, request body, token, 프로필 경로는 보고서에 쓰지 않는다. JSON은 최대
크기·깊이·키 수를 제한하고 키와 값의 타입만 남긴다. 보고서는 Place 서버로 자동 전송되지 않는다.

## 전체 저장 목록 수집

수집은 first-party 저장목록 페이지를 연 뒤 같은 origin에서 JSON을 요청한다. 브라우저 cookie와 header는
Node로 내보내지 않는다. 폴더와 폴더별 bookmark를 설정한 page size로 끝까지 순회하며, 중복 ID,
응답 크기, 최대 목록·장소 수, timeout, 요청 간격을 제한한다. 이름·주소·좌표뿐 아니라 별칭, memo,
원문 URL, 카테고리 코드·경로, 지역 코드, 생성·갱신·사용 시각, available·indoor를 메모리의 NAVER
adapter 결과에 보존한다.

```powershell
$env:PLACE_MEMBER_CONNECTOR_PROFILE_ROOT='<absolute-private-profile-directory>'
$env:PLACE_NAVER_MEMBER_API_BASE_URL='https://<observed-naver-origin>/<observed-api-base>/'
$env:PLACE_NAVER_MEMBER_SESSION_URL='https://<same-observed-origin>/<first-party-session-page>'
$env:PLACE_MEMBER_CONNECTOR_REQUEST_TIMEOUT_MILLISECONDS='15000'
$env:PLACE_MEMBER_CONNECTOR_MAXIMUM_RESPONSE_BYTES='8388608'
$env:PLACE_MEMBER_CONNECTOR_FOLDER_PAGE_SIZE='20'
$env:PLACE_MEMBER_CONNECTOR_BOOKMARK_PAGE_SIZE='500'
$env:PLACE_MEMBER_CONNECTOR_MAXIMUM_LISTS='500'
$env:PLACE_MEMBER_CONNECTOR_MAXIMUM_BOOKMARKS='100000'
$env:PLACE_MEMBER_CONNECTOR_REQUEST_DELAY_MILLISECONDS='100'
npm run member-connector:collect:naver
```

CLI는 개인 필드, ID, checksum, 경로를 출력하지 않고 목록·bookmark·요청 수만 반환한다. 현재 수집
결과는 파일이나 Place 서버에 쓰지 않고 프로세스 종료 시 폐기한다. 실제 ImportBatch로 전달하려면
회원 동의와 일회성·짧은 수명의 connector upload grant를 소유하는 별도 versioned 제출 계약이 먼저
필요하다. 장기 bearer token이나 Web cookie를 CLI에 복사하지 않는다.

## 현재 진단 상태와 중지

`Ctrl+C` 또는 브라우저 종료가 진단 context 종료를 소유한다. profile과 report 디렉터리는 Git·Docker
image·Place DB 밖에 둔다. 현재 로그인·관찰·전체 로컬 수집 코드는 `source-only`다. 제품 확장의 v2
capture는 Backend receiver까지 구현됐지만 공개 Web BFF와 v2 page bridge가 없어 현재 확장 실행
경로에는 조립되지 않았다.
진단 CLI는 개인정보가 포함된 결과를 서버로 보내지 않고 메모리에서 폐기하는 별도 도구이므로 제출
기능을 갖지 않는다. 회원 session 전용 v2 grant BFF는 존재하지만 capability token을 전달하는 공개
BFF와 page bridge는 제공하지 않는다. 이 전용 profile CLI의 로그인 성공은 더 이상 제품 완료 조건이
아니다.
실제 계정 검증이나 Provider 응답이 실패하면 live acquisition은 `integration-gated`로 남는다. 관찰한
계약을 비식별 fixture로 승인하기 전에는 내부 endpoint, selector, 직접 HTTP replay를 제품 코드에
추가하지 않는다.

검증은 `npm run check:member-connector`로 실행한다.
