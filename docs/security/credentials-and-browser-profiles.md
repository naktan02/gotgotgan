# Credentials and browser profiles

Identity social login and Place provider connections are different. Place stores provider metadata
plus opaque secret/profile references; passwords, cookies, MFA seeds, browser profile paths, and
long-lived tokens do not enter tables, source, contracts, logs, or browser payloads.

Automation uses a dedicated profile per Place member/provider under deployment ownership. It never
opens a person's everyday browser profile. Create, exclusive lease, renew, close, and revoke have
explicit owners.
