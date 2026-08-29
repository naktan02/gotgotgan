# Web Platform

통합된 인증, Backend HTTP client, 지도, telemetry, theme, 외부 manifest Adapter를 둔다.
`auth`는 기밀 OIDC BFF와 Provider, 암호화 PostgreSQL, process-pool Adapter를 소유한다.
`membership`은 독립적인 브라우저/Backend bridge와 stateless runtime을 소유하며, 좁은 인증
session 인터페이스만 소비할 수 있다. `auth`는 `membership`을 역참조하지 않는다.

`process-readiness`만 인증·membership·Import의 좁은 readiness 인터페이스를 모을 수 있고 각
lifecycle은 소유하지 않는다. `imports`는 연결 계정 Import용 인증된 브라우저/Backend bridge를
소유하며 좁은 인증 session 인터페이스만 소비한다. `imports/connector`는 확장 프로그램과 통신하는
고정 공개 BFF를 소유한다. 일회성 grant를 발급할 때만 좁은 인증 session 인터페이스를 소비하며
capture 제출 경로는 브라우저 session cookie를 사용하지 않는다.

`library`는 좁은 인증 session 인터페이스와 공용 고정 Backend transport만 소비해 Place detail 및
개인 Library의 same-origin BFF를 제공한다. 권한과 등급 정책은 Backend Product Authorizer에 남긴다.

`visits`는 같은 두 의존성만 소비해 Visit 기록과 Place별 bounded history의 same-origin BFF를
제공한다. 브라우저 입력에서는 내부 evidence와 member ID를 허용하지 않으며, 불변 occurrence와 replay
판정은 Backend Visits owner가 담당한다.

`writing`도 인증 session과 고정 Backend transport만 소비한다. owner 목록·상세는 검증해 중계하지만
browser mutation은 private Note 생성·수정으로 제한하고 visibility를 서버에서 고정한다. revision과
optimistic conflict는 Backend Writing owner에 남는다.
