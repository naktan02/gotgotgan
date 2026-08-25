# Authentication and authorization

Place validates token signature, issuer, audience, time claims, and required scope, then resolves a
local membership from `(issuer, subject)`. Member, reviewer, administrator, and owner are protected
Place Authority Roles. User Grade is a non-authority participation/reputation/benefit classification,
and Product Tier is a separate commercial feature/quota axis. Neither grants administrative
permission. Every resource operation enforces Place permissions and last-owner protection where
applicable.

No credential means an anonymous visitor, not an implicit guest. A verified but unmapped principal
is rejected rather than downgraded to anonymous. Anonymous access is limited to an explicitly public
projection. Login and token validation do not create a Place row. Just-in-time onboarding requires
the verified principal to accept the complete server-selected current consent document/version set.
One transactional store operation creates or resolves the membership, records consent versions, and
appends the audit outcome; a retry never changes existing membership status, role, grade, or tier.
New self-service memberships always receive the non-elevated `member` Authority Role inside the use
case, while initial User Grade and Product Tier are injected Place policy rather than browser-chosen
authority.

Place records allow and denial decisions through an audit port without retaining raw tokens. Stage 3
provides normalized PostgreSQL membership/resource-grant/consent storage, append-only audit, and
operator-authorized initial-owner bootstrap persistence. The bootstrap operation serializes the
empty-membership decision and membership/audit write in one transaction; browser input can never
trigger it. These adapters remain source-only until an approved process composition owns the pool.

The browser login boundary is a confidential BFF. It validates HTTPS callback configuration,
requires `openid`, rejects external post-login redirects, consumes one-time server-side login
transactions, validates state/nonce/PKCE through the OIDC adapter, bounds session lifetime by token
expiry, and sanitizes callback failures. Cookies are `__Host-`, Secure, HttpOnly, SameSite=Lax and
contain opaque identifiers only. Logout deletes server-side session state before clearing the cookie.
In-memory stores are not an allowed production composition. The PostgreSQL adapter encrypts complete
transaction and token payloads with AES-256-GCM before storage, binds their kind/ID/expiry/key ID as
authenticated data, atomically consumes transactions, and supports retained decryption keys during
rotation. Protected one-line secret-file configuration supplies the database URL, confidential client
secret, and rotatable keyring. The Web process factory owns a bounded pool, at-most-1,000-row expired
record cleanup per table, and explicit close operation; no public auth route or deployment connection
is active yet.

Authority-role changes go through the `access` module's single mutation interface. Administrators
can manage only non-owner roles. Any operation touching the current owner role or assigning the owner
role requires `ownership.manage`. Persistence must perform expected-role comparison, final-active-
owner protection, mutation, and outcome audit atomically; a concurrent update returns a conflict
instead of being overwritten. The PostgreSQL adapter locks active owners in stable order and rolls a
role mutation back if its outcome audit cannot be recorded. User Grade and Product Tier remain
outside this authority path.
