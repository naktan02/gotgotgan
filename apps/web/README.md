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

Stage 5는 `/search`의 responsive 목록/지도 작업 공간과 `/api/search/*` BFF를 제공한다. Web은
공유 계약으로 Backend 응답을 다시 검증하고 fixed Backend origin/path만 호출한다. 입력 debounce,
교체 요청 취소, bounds 재검색, filter, pagination, 목록/marker 선택, mobile 전환과 상태별
Playwright evidence가 있다. 지도는 live provider가 아닌 결정적 좌표 renderer이므로 실제 tile,
사진, provider 평점이나 attribution을 표시하지 않는다.

Stage 7.7은 `/library`의 authenticated Library-first 작업 공간과 `/api/library/*`,
`/api/places/{placeId}` BFF를 제공한다. 상태별 Place, Tag all/any, Collection, Place detail을
desktop/mobile에서 탐색하며 session 부재·empty/loading/error/pagination을 구분한다. Web은 opaque
session만 받고 bearer token, Backend origin, Product Tier 이름을 feature로 전달하지 않는다.
