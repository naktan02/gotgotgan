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
