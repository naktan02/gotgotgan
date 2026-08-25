# Authentication and authorization

Place validates token signature, issuer, audience, time claims, and required scope, then resolves a
local membership from `(issuer, subject)`. Member, reviewer, administrator, and owner are Place roles;
subscription or product tier is a separate axis. Every resource operation enforces Place policy and
last-owner protection where applicable.

No credential means an anonymous visitor, not an implicit guest. A verified but unmapped principal
is rejected rather than downgraded to anonymous. Anonymous access is limited to an explicitly public
projection. Place records allow and denial decisions through an audit port without retaining raw
tokens. Stage 3 provides normalized PostgreSQL membership/resource-grant storage, append-only audit,
and operator-authorized initial-owner bootstrap persistence. The bootstrap operation serializes the
empty-membership decision and membership/audit write in one transaction; browser input can never
trigger it. This adapter remains source-only until an approved process composition owns its pool.

The browser login boundary is a confidential BFF. It validates HTTPS callback configuration,
requires `openid`, rejects external post-login redirects, consumes one-time server-side login
transactions, validates state/nonce/PKCE through the OIDC adapter, bounds session lifetime by token
expiry, and sanitizes callback failures. Cookies are `__Host-`, Secure, HttpOnly, SameSite=Lax and
contain opaque identifiers only. Logout deletes server-side session state before clearing the cookie.
In-memory stores are not an allowed production composition.

Authority-role changes go through the `access` module's single mutation interface. Administrators
can manage only non-owner roles. Any operation touching the current owner role or assigning the owner
role requires `ownership.manage`. Persistence must perform expected-role comparison, final-active-
owner protection, mutation, and outcome audit atomically; a concurrent update returns a conflict
instead of being overwritten. The PostgreSQL adapter locks active owners in stable order and rolls a
role mutation back if its outcome audit cannot be recorded. Product tier remains outside this
authority path.
