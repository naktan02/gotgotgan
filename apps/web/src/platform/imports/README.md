# Browser imports platform

이 경계는 Place 화면과 내부 Backend 또는 설치된 Place Connector 사이의 통신을 소유한다.

- 기존 import client는 서버 OIDC session을 해석하고 고정된 Import Backend 경로만 호출한다.
- `connector/page-session/connector-page-session.ts`는 window message의
  origin/source/version/operation을 검증하고
  probe·prepare·start·cancel 및 progress/result 수명주기를 한 곳에서 닫는다. `start` timeout,
  명시적 `cancel`, 화면 unmount의 `close`는 활성 작업에 `cancel-import`를 전송하고 대기 중인
  Promise와 timer를 정리한다. 이미 terminal `result`를 받은 작업에는 취소를 전송하지 않는다.
- `connector/runtime/next-connector-lifecycle.ts`는 v2 회원 grant Backend의 명시적 활성화와 bounded
  timeout을 소유하며 비활성 또는 부분 설정 상태에서는 fail closed한다.
- `connector/transfers`는 v2 import/outbound grant의 회원 전용 BFF 경계다. OIDC session, 설정된 exact
  공개 Origin, body의 `placeOrigin`을 모두 요구하고, 요청·응답은 stream byte 상한과 versioned schema로
  다시 검증한다. 내부 Backend 주소·임의 header·원시 오류는 반환하지 않는다.
- `operations`는 작업 목록·요약·상세·항목·command의 회원 전용 BFF 경계다. endpoint별 작은 byte
  상한으로 JSON stream을 먼저 닫은 뒤 계약을 검증하고, 상태가 일치하는 bounded Problem만 전달한다.
  인증과 Backend timeout은 Adapter 안에 숨기며 route는 이 공개 Interface만 호출한다.
- v2 status/chunk/complete와 consume/attempt-intent/attempt-report/reconciliation capability route는 Web에
  등록하지 않는다. Background fetch의 extension Origin은 현재 HTTPS `placeOrigin` 계약과 다르고,
  Place 탭의 isolated-world same-origin fetch는 Authorization capability가 같은 Origin의 Service Worker를
  통과하기 때문이다. 별도 extension-origin 계약, Backend 검증/CORS 정책, Chromium·Firefox 실행 증거가
  함께 생기기 전까지 이 경계는 fail closed다.
- Stage 10 cutover에서 v1 `/api/connector/grants`, `/api/connector/captures`와 전용 client를 제거했다.
  Backend와 Extension의 v1 fallback이 이미 제거되어 정상 호출 경로가 없고, 남겨 둔 capability BFF는
  같은 Origin의 Service Worker에 token을 노출하는 dead security surface가 되기 때문이다. 저장 데이터나
  migration은 이 cutover의 대상이 아니다.

`page-session`, `runtime`, `transfers`는 서로 다른 변경 이유를 가진 동급 하위 모듈이다.
새 Connector workflow를 이 폴더의 평면 파일로 추가하지 않고 해당 lifecycle을 소유하는 하위 모듈에
배치한다. route 파일은 이 공개 Interface만 호출하는 얇은 Next Adapter로 유지한다.

이 폴더는 Provider parser, browser extension 구현, feature UI를 소유하지 않는다. Web 화면은 이
interface에만 의존하므로 UI 교체가 인증·네트워크·확장 수명주기를 함께 수정하게 만들지 않는다.
