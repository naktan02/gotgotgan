# Browser imports platform

이 경계는 Place 화면과 내부 Backend 또는 설치된 Place Connector 사이의 통신을 소유한다.

- 기존 import client는 서버 OIDC session을 해석하고 고정된 Import Backend 경로만 호출한다.
- `connector/connector-backend-client.ts`는 배포가 주입한 하나의 내부 Backend origin만 사용한다.
- `connector/browser-connector-http.ts`는 grant route에서 OIDC session을 요구하고 capture route에서는
  Web cookie 대신 `PlaceConnector` authorization만 허용한 뒤 모든 입출력을 다시 검증한다.
- `connector/connector-page-session.ts`는 window message의 origin/source/version/operation을 검증하고
  probe·prepare·start·cancel 및 progress/result 수명주기를 한 곳에서 닫는다. `start` timeout,
  명시적 `cancel`, 화면 unmount의 `close`는 활성 작업에 `cancel-import`를 전송하고 대기 중인
  Promise와 timer를 정리한다. 이미 terminal `result`를 받은 작업에는 취소를 전송하지 않는다.
- `connector/next-connector-lifecycle.ts`는 명시적 활성화와 bounded timeout을 소유하며 비활성 또는
  부분 설정 상태에서는 fail closed한다.

이 폴더는 Provider parser, browser extension 구현, feature UI를 소유하지 않는다. Web 화면은 이
interface에만 의존하므로 UI 교체가 인증·네트워크·확장 수명주기를 함께 수정하게 만들지 않는다.
