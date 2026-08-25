# Place web

This Next.js application is the Place product surface. Routes stay thin and compose screens through
the dependency direction documented in `DESIGN.md` and the repository `AGENTS.md`.

Stage 2 contains the responsive product shell, the family-navigation consumer contract, and a
source-only confidential OIDC BFF core. The BFF keeps login transactions and tokens server-side and
uses opaque secure cookies; its `openid-client` adapter performs Authorization Code + PKCE S256.
An encrypted PostgreSQL adapter now provides atomic one-time transactions and shared sessions, while
the process composition owns readiness and pool closure. Next route activation, protected secret-file
loading, expired-record cleanup, and Identity/Gateway provisioning remain gated, so search, maps, and
provider imports remain explicitly not integrated.
