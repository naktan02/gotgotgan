# 회원 로컬 커넥터

`member-connector`는 회원 PC에서 실행하는 Place 소유 Connector 경계다. 최종 형태는 사용자가 현재
로그인한 브라우저 profile을 재사용하는 하나의 다중 브라우저·다중 Provider 확장이다. NAVER·Kakao·
Google은 별도 확장이 아니라 Provider Adapter로 추가한다. 캡처는 짧은 수명의 일회성 Place grant로만
제출하며 Provider cookie·token·profile 경로를 서버로 보내지 않는다.

현재는 확장의 provider-neutral application 경계, WebExtensions browser Adapter, 고정 공개 Place
origin으로 제출하는 capture Adapter, WXT entrypoint와 Chromium·Firefox build 검증을 source-only로
구현했다. 등록된 실제 Provider Adapter와 host permission은 아직 없으므로 팝업도 브라우저 준비 상태만
표시한다. 공개 BFF route, 실설치 배포, live Provider 수집과 서버 상세 보강은 여전히
`not-integrated` 또는 `integration-gated`다.

전용 Playwright profile을 쓰는 기존 로그인·비식별 네트워크 관찰·NAVER 전체 저장 목록 bounded
수집기는 진단 CLI로 남아 있다. 실관찰에서 평소 브라우저의 로그인 상태를 재사용하지 못했으므로 주
회원 Import 경로로 사용하지 않고 진단·fixture/replay·E2E·통제된 fallback에만 쓴다.

## 구현 구조

사용하지 않는 Kakao·Google·Safari leaf는 미리 만들지 않고 첫 동작 capability와 fixture가 생길 때
생성한다. 현재 확장 경로는 다음과 같다.

```text
src/
  application/
    collect-saved-library.ts    pagination·상한·batch·checksum·receipt를 숨기는 깊은 Interface
    handle-connector-command.ts Place command와 작업 lifecycle 조립
    ports/
      saved-place-source.ts
      provider-session.ts
      capture-submission.ts
  adapters/
    browser/webextensions/     tab·message·permission·cancel·resource close
    place/capture-upload/      공개 BFF와 일회성 Connector grant만
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
않는다. 자세한 결정은 [`../../docs/adr/0012-cross-browser-member-connector.md`](../../docs/adr/0012-cross-browser-member-connector.md)를 따른다.

## 확장 산출물과 브라우저 상태

WXT `0.21.4`와 Vite `6.4.3`을 고정했다. Chrome·Edge·Whale은 Chromium Manifest V3 산출물 하나를
공유하고 Firefox는 별도 Manifest V3 산출물을 만든다. Whale 전용 코드를 복제하지 않으며 browser
감지는 Whale을 Chrome보다 먼저 판별한다. Safari는 아직 산출물이 없다.

현재 manifest의 기본 권한은 `storage`뿐이고 Provider host permission은 없다. Place content bridge도
빌드 시 주입한 정확한 공개 origin 하나에서만 동작한다. 실제 배포 산출물은 다음처럼 만든다.

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

이 검증은 Chromium/Firefox build와 manifest 상한을 확인한다. 실제 Chrome·Edge·Whale·Firefox 설치,
Place page handshake, Provider permission, public BFF receipt를 실행하는 E2E는 다음 단계다. 특히
Whale은 Chromium 산출물 호환 구조만 검증했으며 실설치 smoke 전까지 `integration-gated`다. 상세 계약은
[`../../docs/api/connector-v1.md`](../../docs/api/connector-v1.md)를 따른다.

## 현재 진단 CLI 폴더 의미

```text
src/
  acquisition/
    adapters/naver/       현재·legacy folder/bookmark schema, 전체 pagination, field 보존
    adapters/playwright/  first-party 페이지 안의 credential-including JSON fetch와 context 수명주기
    tests/                전체 목록 순회·상한·schema drift·응답 크기·종료 테스트
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
image·Place DB 밖에 둔다. 현재 로그인·관찰·전체 로컬 수집 코드는 `source-only`다. capture upload
Adapter는 source-only지만 공개 BFF route와 실제 Provider가 없어 제출 흐름은 `not-integrated`다. 이
전용 profile CLI의 로그인 성공은 더 이상 제품 완료 조건이 아니다.
실제 계정 검증이나 Provider 응답이 실패하면 live acquisition은 `integration-gated`로 남는다. 관찰한
계약을 비식별 fixture로 승인하기 전에는 내부 endpoint, selector, 직접 HTTP replay를 제품 코드에
추가하지 않는다.

검증은 `npm run check:member-connector`로 실행한다.
