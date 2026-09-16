# Admin Web Working Agreements

The repository and workspace `AGENTS.md` files apply first. This app is a separate administrator
frontend and process; it must never become a conditionally revealed section of the member Web app.

- Keep App Router files thin. Compose UI in `shells`, use cases in `features`, server adapters in
  `platform`, and business-neutral values in `shared`.
- Browser credentials are opaque, HttpOnly cookies. Never serialize OIDC tokens, provider
  credentials, internal references, or backend origins to the browser.
- Every administrator request resolves the server-side session and relies on Backend authorization.
  Browser-supplied roles are display data only and never authorization evidence.
- Do not invent dashboard metrics, place records, collection jobs, health states, or operator
  identities. Render explicit pending, unavailable, forbidden, or not-implemented states.
- A navigation destination stays disabled until its owning Backend Interface and reviewed BFF route
  exist. Disabled items must explain `Backend Interface 미구현`.
- The administrator sidebar does not include Family Services.
- Add tests for fail-closed authorization and browser data minimization with every access change.
