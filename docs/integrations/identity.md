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
activation and owns periodic cleanup plus signal close. Route activation still waits for reviewed
handlers, Identity provisioning, and Gateway validation.
