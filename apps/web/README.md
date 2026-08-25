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
internals. It exposes no tokens or internal endpoints. Identity/Gateway
provisioning, search, maps, and provider imports remain explicitly not integrated.
