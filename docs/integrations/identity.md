# Identity

Identity remains the common login authority. Place later registers an OIDC client/manifest and maps
verified `(issuer, subject)` to a local membership. Place owns roles, tiers, grants, visibility,
provider connections, and final resource authorization.

Adding Place should require client configuration and integration tests, not new Identity business
tables or Place-specific login logic. The Studio guest contract is Automation-owned and is not reused;
public Place reading is anonymous until a distinct authenticated guest requirement exists.
