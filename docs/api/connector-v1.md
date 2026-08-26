# Connector v1 계약

Connector v1은 Place 페이지, 회원 브라우저의 Place Connector 확장, 공개 Place BFF 사이의
메시지와 캡처 제출 경계를 정의한다. 작성 원본은
`packages/contracts/src/connector/index.ts`이고 배포용 JSON Schema는
`packages/contracts/connector/place-connector.v1.schema.json`으로 생성한다. JSON을 별도 원본으로
수정하지 않는다.

현재 delivery state는 `source-only`다. 확장 쪽 계약·application·browser/upload Adapter와
Chromium/Firefox 산출물 검증은 구현됐지만 `/api/connector/captures` BFF route, 실제 Provider Adapter,
확장 설치 배포는 아직 연결하지 않았다.

## 메시지 방향

- Place page → 확장: `probe`, `start`, `cancel` command만 보낸다.
- 확장 → Place page: `ready`, `progress`, `result` event만 보낸다.
- 확장 → 공개 Place BFF: 순서가 있는 bounded capture batch를 제출하고 receipt를 받는다.
- Provider page/session → Place: cookie, token, 비밀번호, MFA 값, browser profile 경로를 보내지 않는다.

메시지는 `version`, `operationId`, `installationId`와 Provider/browser 식별자를 명시한다. 지원하지
않는 version, operation, Provider 또는 browser는 안전한 결과 코드로 닫으며 raw 오류와 Provider
응답 값을 Place page로 전달하지 않는다.

## 작업 grant와 제출 경계

Place Web이 발급하는 grant는 불투명 token이며 정확한 공개 Place origin, 회원 연결 대상 Provider,
한 Import operation, 멱등 키, 만료 시각, batch/item/byte 상한에 묶인다. 확장은 임의 upload URL을
받지 않고 같은 공개 origin의 고정 경로 `/api/connector/captures`만 호출한다. 요청에는 Web cookie를
붙이지 않으며 redirect를 따르지 않는다.

각 batch에는 0부터 증가하는 sequence, 마지막 batch 여부, item 수, UTF-8 JSON payload와 SHA-256
checksum이 있다. 서버 receipt의 operation·sequence·checksum과 누적 item/byte 수가 요청 상태와 모두
일치해야 제출 성공으로 처리한다. grant 상한을 넘은 캡처는 분할로 우회하지 않고 시작 전에 또는 수집
중 안전하게 중단한다.

현재 BFF route는 아직 구현되지 않았다. 따라서 upload Adapter가 존재하더라도 실제 capture 제출은
`not-integrated`이며 Provider host permission도 manifest에 선언하지 않았다.

## 브라우저 산출물 상태

| 대상 | 산출물 | 현재 증거 | 상태 |
| --- | --- | --- | --- |
| Chrome | Chromium Manifest V3 | build·manifest 검증 | `source-only` |
| Edge | Chrome과 같은 Chromium Manifest V3 | build·manifest 호환 검증 | `source-only` |
| Whale | Chrome과 같은 Chromium Manifest V3 | build·manifest 호환 검증, 실설치 미검증 | `integration-gated` |
| Firefox | 별도 Firefox Manifest V3 | build·manifest·data declaration 검증 | `source-only` |
| Safari | 없음 | packaging·signing·install 환경 없음 | `not-integrated` |

Whale 전용 복제 프로젝트나 산출물을 만들지 않는다. Whale이 Chromium 호환 확장 API와 Manifest V3를
사용하므로 Chromium 산출물을 공유하되, 실제 Whale 설치·메시지·permission smoke가 통과하기 전에는
지원 완료로 표시하지 않는다.

현재 manifest의 기본 권한은 `storage` 하나다. 실제 NAVER Adapter를 추가할 때 사용자가 기능을
선택한 시점에 필요한 exact origin만 선택 권한으로 요청한다. Kakao·Google도 각 Adapter와 비식별
fixture가 생길 때 같은 방식으로 추가하며 미리 광범위 host permission을 넣지 않는다.

## 검증

```powershell
npm run check:contracts
npm run check:member-connector
```

`check:member-connector`는 fake port 기반의 전체 pagination, bounded batch, checksum/receipt,
progress/cancel, origin/grant 검증과 browser Adapter 단위 테스트를 실행한 뒤 Chromium·Firefox 산출물을
만들어 manifest를 검사한다. 이는 실제 Whale 설치, 실제 NAVER session 재사용 또는 공개 BFF receipt의
end-to-end 증거를 대신하지 않는다.
