# Place web

This Next.js application is the Place product surface. Routes stay thin and compose screens through
the dependency direction documented in `DESIGN.md` and the repository `AGENTS.md`.

Stage 2 contains the responsive product shell, the family-navigation consumer contract, and a
source-only confidential OIDC BFF core. The BFF keeps login transactions and tokens server-side and
uses opaque secure cookies; its `openid-client` adapter performs Authorization Code + PKCE S256.
An encrypted PostgreSQL adapter now provides atomic one-time transactions and shared sessions, while
the process composition owns readiness, bounded expired-record cleanup, and pool closure. A protected
configuration loader accepts the database URL, OIDC client secret, and encryption keyring only through
referenced secret files. The Node-only Next instrumentation hook installs this runtime only when
explicitly enabled, schedules bounded cleanup, and closes it on process signals. Reviewed
source-only start, callback, and POST-only logout handlers fail closed while the runtime is disabled.
A colocated membership platform exposes thin current-consent and onboarding routes, resolves bearer
evidence from the server-side session, and calls only fixed backend paths. It revalidates safe
projections and has an independent fail-closed runtime so auth does not depend on membership
internals. Process readiness checks the OIDC database and internal Backend only when their deployment
flags are enabled and publishes no dependency details. It exposes no tokens or internal endpoints. Identity/Gateway
provisioning and provider imports remain explicitly not integrated.

Stage 6의 `/`는 곳곳간 내부 Canonical Place 카탈로그만 탐색하는 지도 중심 홈이다. 검색어를
지역·장소 유형·속성·잔여 검색어의 제거 가능한 해석 칩으로 보여 주며, 목록과 지도는 같은 결과와
선택을 공유한다. Provider 검색·상세는 대화형 브라우저 경로에 없고 NAVER·Google·Kakao 데이터는
관리자 수집 또는 설정의 서비스별 가져오기 흐름에서만 들어온다. 이전 `/search` 진입은 `/`로
redirect한다.

즐겨찾기 동작은 `saved`/`wanted` 상태가 아니라 사용자 소유 Collection membership을 만든다. 홈은
Collection 요약과 이번 접속의 최근 정리만 빠르게 보여 주고, 생성·순서·다중 선택 등 본격 관리는
`/library`가 소유한다. 지도 renderer가 실패하거나 결과에 좌표가 없어도 목록 검색과 Collection
정리는 계속 사용할 수 있다.

Stage 7.7은 `/library`의 authenticated Library-first 작업 공간과 `/api/library/*`,
`/api/places/{placeId}` BFF를 제공한다. 상태별 Place, Tag all/any, Collection, Place detail을
desktop/mobile에서 탐색하며 session 부재·empty/loading/error/pagination을 구분한다. Web은 opaque
session만 받고 bearer token, Backend origin, Product Tier 이름을 feature로 전달하지 않는다.
