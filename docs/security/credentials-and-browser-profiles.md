# Credentials and browser profiles

Identity login and Place provider connections are different. Provider-account tables store metadata
plus opaque secret/profile references; provider passwords, cookies, MFA seeds, browser profile paths,
and provider bearer tokens do not enter those tables, source, contracts, logs, or browser payloads.
The confidential browser BFF is a separate exception: it stores its access/refresh token payload only
as authenticated ciphertext in `browser_auth`, while encryption keys remain deployment secrets outside
the database. Browser cookies still contain opaque IDs only.

Automation uses a dedicated profile per Place member/provider under deployment ownership. It never
opens a person's everyday browser profile. Create, exclusive lease, renew, close, and revoke have
explicit owners.
