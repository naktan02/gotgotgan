# Identity

Identity remains the common login authority. Place later registers an OIDC client/manifest and maps
verified `(issuer, subject)` to a local membership. Place owns roles, tiers, grants, visibility,
provider connections, and final resource authorization.

Adding Place should require client configuration and integration tests, not new Identity business
tables or Place-specific login logic. The Studio guest contract is Automation-owned and is not reused;
public Place reading is anonymous until a distinct authenticated guest requirement exists.

The resource-server adapter uses an injected HTTPS issuer, audience, JWKS URI, fixed algorithm
allow-list, required time claims, and required scopes. It produces only `(issuer, subject)`; email and
token roles are ignored. The OIDC client is not provisioned until Place owns a working callback,
deployable release, Gateway route/health declaration, and the workspace onboarding validation gate.

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

The Backend production composition now installs the resource-server verifier from injected issuer,
audience, JWKS URI, and scopes; it still performs no network discovery at configuration time and
cannot use test auth. This closes the Place-owned composition gate only. Provisioning the client,
mounting its generated secret, and verifying the real issuer remain Identity-owned integration work.

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
