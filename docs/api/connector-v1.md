# Connector v1 계약

Connector v1은 Place 페이지, 회원 브라우저의 Place Connector 확장, 공개 Place BFF 사이의 메시지와
캡처 제출 경계를 정의한다. 작성 원본은 `packages/contracts/src/connector/index.ts`이고 배포용 JSON
Schema는 `packages/contracts/connector/place-connector.v1.schema.json`으로 생성한다. JSON을 별도
원본으로 수정하지 않는다.

현재 확장 계약·NAVER Provider Adapter·WebExtensions Adapter·고정 Place origin 업로드 Adapter,
Web BFF, Backend의 `/v1/connector-grants`와 `/v1/connector-captures` 수신 경계는 `source-only`다.
Backend는 실제 PostGIS에서 grant 재발급, 이전 token 폐기, 순서·상한·checksum 검증, 암호화 원본,
정규화 ImportItem과 Collection materialization intent를 하나의 ImportBatch에 연결한다. Chromium/Firefox 산출물과 가짜
확장을 이용한 desktop/mobile imports E2E도 검증한다. Whale 실제 설치와 로그인된 NAVER session
smoke만 `integration-gated`로 남아 있다.

## 메시지 방향

- Place page → 확장: `probe`, `prepare-import`, `start`, `cancel` command만 보낸다.
- 확장 → Place page: `ready`, `prepared`, `progress`, `result` event만 보낸다.
- `prepare-import`는 선택된 Provider의 exact origin 권한을 확인하고, 없으면 확장 소유 권한 탭을 연다.
- 확장 → 공개 Place BFF: grant의 exact Place origin 탭에서 isolated world same-origin 요청으로 순서가
  있는 bounded capture batch를 제출하고 receipt를 받는다.
- Provider page/session → Place: cookie, token, 비밀번호, MFA 값, browser profile 경로를 보내지 않는다.

메시지는 `version`, `operationId`, `installationId`와 Provider/browser 식별자를 명시한다. 지원하지
않는 version, operation, Provider 또는 browser는 안전한 결과 코드로 닫으며 raw 오류와 Provider 응답
값을 Place page로 전달하지 않는다. 성공한 `result`는 서버가 반환한 `importBatchId`만 전달한다.

## 작업 grant와 제출 경계

Place Web이 발급하는 grant는 불투명 token이며 정확한 공개 Place origin, 회원 연결 대상 Provider,
한 Import operation, 멱등 키, 만료 시각, batch/item/byte 상한에 묶인다. 확장은 임의 upload URL을
받지 않고 같은 공개 origin의 고정 경로 `/api/connector/captures`만 호출한다. 요청에는 Web cookie를
붙이지 않으며 redirect를 따르지 않는다.

Web의 `/api/connector/grants`는 OIDC session이 있는 요청만 고정 Backend 경로로 전달한다.
`/api/connector/captures`는 Web cookie가 아니라 `PlaceConnector` authorization만 허용한다. 두 route는
환경에서 주입한 하나의 내부 Backend origin만 사용하며 browser 입력으로 Backend 주소를 선택하지
않는다. BFF는 요청을 받은 공개 origin을 Backend에도 전달하고, Backend는 배포 설정의 정확한 공개
origin과 일치할 때만 grant와 capture를 처리한다.

Backend는 grant token 원문을 저장하지 않고 SHA-256 digest만 보관한다. 같은 회원·멱등 키·요청은
동일 operation과 ImportBatch를 재사용하면서 새 token으로 회전하며, 이전 token은 즉시 무효가 된다.
캡처는 `pending` receipt와 보존 메타데이터를 먼저 예약하고 AES-256-GCM 원본 저장 뒤 ImportItem,
Materialization intent, 누적 receipt를 한 transaction으로 확정한다. 전송이 끊기면 같은 sequence와
checksum만 재개할 수 있고, 앞 순서를 건너뛰거나 기존 sequence의 내용을 바꾸면 충돌한다.

각 batch에는 0부터 증가하는 sequence, 마지막 batch 여부, item 수, UTF-8 JSON payload와 SHA-256
checksum이 있다. 서버 receipt의 operation·sequence·checksum과 누적 item/byte 수가 요청 상태와 모두
일치해야 제출 성공으로 처리한다. grant 상한을 넘은 캡처는 분할로 우회하지 않고 시작 전 또는 수집
중 안전하게 중단한다.

## Provider 권한과 NAVER Adapter

manifest의 기본 권한은 `scripting`, `storage`다. Place content bridge와 capture BFF에는 build가
주입한 정확한 Place origin만 사용한다. Capture 제출은 해당 Place 탭의 isolated world에서
same-origin으로 실행한다. `scripting`은 이 제출과 선택 권한이 있는 Provider 페이지의 isolated
world 요청에만 사용한다. NAVER 가져오기를 선택하면 확장 소유 권한
탭에서 사용자가 직접 누른 Provider 버튼이 `https://pages.map.naver.com/*`만 선택 권한으로 요청한다.
NAVER Adapter는 background의 third-party 요청에 browser cookie를 의존하지 않고, 로그인된 NAVER
저장 페이지 안에서 first-party JSON 요청으로 session을 조용히 확인하고 모든
폴더와 bookmark 페이지를 bounded 순회한다. 목록 ID·이름·목록 순서·장소 순서를 캡처에 보존한다.

Kakao·Google은 각 Provider Adapter와 비식별 fixture가 생길 때 exact optional permission을 별도로
추가한다. 미리 광범위한 host permission을 넣거나 Provider별 확장을 만들지 않는다.

## 브라우저 산출물 상태

| 대상 | 산출물 | 현재 증거 | 상태 |
| --- | --- | --- | --- |
| Chrome | Chromium Manifest V3 | unit·build·manifest 검증 | `source-only` |
| Edge | Chrome과 같은 Chromium Manifest V3 | build·manifest 호환 검증 | `source-only` |
| Whale | Chrome과 같은 Chromium Manifest V3 | build·manifest 호환 검증, 실설치 미검증 | `integration-gated` |
| Firefox | 별도 Firefox Manifest V3 | unit·build·manifest·data declaration 검증 | `source-only` |
| Safari | 없음 | packaging·signing·install 환경 없음 | `not-integrated` |

Whale 전용 복제 프로젝트나 산출물을 만들지 않는다. Chromium 산출물을 공유하되 실제 Whale
설치·메시지·Provider 권한 탭·선택 권한·NAVER session smoke가 통과하기 전에는 지원 완료로 표시하지 않는다.

## 검증

```powershell
npm run check:contracts
npm run check:member-connector
npm run test:e2e -- tests/e2e/imports.spec.ts
```

결정적 검증은 pagination, source list 순서, bounded batch, checksum/receipt, progress/cancel,
origin/grant, permission/session, Chromium·Firefox manifest와 가짜 확장 imports workflow를 포함한다.
실제 Whale 설치와 실제 NAVER session 재사용은 별도의 live 증거가 필요하다. Backend receipt와
PostGIS 영속화는 fixture 기반 통합 테스트까지 완료했다.
