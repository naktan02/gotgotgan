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
