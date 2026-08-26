# Identity

Identity remains the common login authority and the authority for one cross-product
`platform_owner`. Place maps verified `(issuer, subject)` to a local membership and projects only a
signed, Place-audience-bound `platform_owner` entitlement into its sole local `owner`. Place owns
all other roles, tiers, grants, visibility, provider connections, and final resource authorization.

Adding Place should require client configuration and integration tests, not new Identity business
tables or Place-specific login logic. The Studio guest contract is Automation-owned and is not reused;
public Place reading is anonymous until a distinct authenticated guest requirement exists.

리소스 서버 어댑터는 주입된 HTTPS 발급자, 대상, JWKS URI, 고정 알고리즘 허용 목록, 필수 시간
클레임과 주체를 검증한다. 결과로 `(issuer, subject)`만 만들고 이메일, 토큰 역할과 선택적인 scope
클레임은 권한 근거로 사용하지 않는다. 로그인 요청에 필요한 scope는 Web OIDC 클라이언트가 별도로
보낸다. OIDC 클라이언트 프로비저닝은 Place가 정상 콜백, 배포 가능한 릴리스, Gateway 경로·상태
선언과 워크스페이스 온보딩 검증 게이트를 갖춘 뒤에 진행한다.

The service-owned manifest is `deploy/identity/oidc-client.json`. It declares a confidential web
client, an environment-expanded public origin, and no Identity role assertions; it is an
unprovisioned input, not evidence of an active connection. The web BFF core and `openid-client`
adapter implement Authorization Code + PKCE S256 with state and nonce. Login transactions, access
tokens, refresh tokens, and sessions remain server-side; the browser receives only host-bound opaque
cookies. Encrypted PostgreSQL storage now atomically consumes transactions and shares sessions across
Web replicas. Protected secret-file loading and bounded expiry cleanup exist as source-only Web
interfaces. The actual Node Next lifecycle now installs them only behind explicit fail-closed
activation and owns periodic cleanup plus signal close. Route activation still waits for Identity
provisioning and Gateway validation.

The reviewed Web handlers now exist source-only for login start, callback, and POST-only logout.
They consume the process-owned runtime through a shared lifecycle registry and fail closed with a
sanitized correlated problem while it is disabled. This completes the route source gate only;
Identity client provisioning, deployment secret mounting, and Gateway validation are still required
before activation.

The backend membership-onboarding transport is also source-only. It independently verifies bearer
evidence into `(issuer, subject)` and accepts no browser-supplied principal or Place authority fields.
The Web BFF now has a fixed server-side onboarding client and resolves the bearer from its encrypted
opaque-cookie session; the token never enters a browser response. This requires no Place-specific
Identity table or login change. Production activation, client provisioning, and public Gateway
validation remain intentionally absent.

Backend 운영 구성은 주입된 발급자, 대상과 JWKS URI로 리소스 서버 검증기를 설치한다. 설정 시점의
네트워크 탐색은 수행하지 않고 테스트 인증도 사용할 수 없다. 이는 Place 소유 구성 게이트만 닫는다.
클라이언트 프로비저닝, 생성된 비밀 마운트와 실제 발급자 검증은 계속 Identity 소유 통합 작업이다.

## Platform Owner entitlement

The optional Identity Backend call uses `platform-entitlement-response.v1` over the private
`identity-services` network. Place verifies ES256, `typ=platform-entitlement+jwt`, assertion issuer,
Place audience, `(identity_issuer, sub)`, expiration, and `owner_revision`; it never reads Identity
tables. On onboarding and authenticated Backend access, a newer owner revision atomically replaces
the local Owner and appends audit evidence. `platform_admin` and `platform_operator` remain global
staff ranks and do not grant Place `administrator` or `reviewer` authority.

The Compose and application wiring are currently `source-only` and optional. No public Gateway path
is added for this internal Interface, and no user has been assigned by source initialization.

## 로컬 HTTP 예외

로컬 Docker 통합은 `deploy/identity/local/oidc-client.json`과
`PLACE_OIDC_ALLOW_INSECURE_LOCAL_HTTP=true`를 함께 사용할 때만 `http://localhost`,
`http://*.localhost`, loopback IP의 issuer·JWKS·callback을 허용한다. 플래그 값은 `true` 또는
`false`만 받을 수 있고, 플래그가 있어도 일반 HTTP 호스트는 거부한다. 운영 manifest는
`devMode=false`를 유지하며 HTTPS 요구를 완화하지 않는다.

Identity가 제공하는 것은 검증된 `(issuer, subject)`뿐이다. 최초 Place 접속 시에만 Place가
동의와 함께 membership 행을 만들고, 사용자 등급·상품 티어·관리자 authority role은 계속
Place가 소유한다. 따라서 새 서비스 사용자나 Place 등급을 추가하기 위해 Identity 스키마나
공통 로그인 코드를 수정하지 않는다.
