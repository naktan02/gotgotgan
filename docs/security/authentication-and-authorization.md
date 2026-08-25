# Authentication and authorization

Place validates token signature, issuer, audience, time claims, and required scope, then resolves a
local membership from `(issuer, subject)`. Member, reviewer, administrator, and owner are Place roles;
subscription or product tier is a separate axis. Every resource operation enforces Place policy and
last-owner protection where applicable.

No credential means an anonymous visitor, not an implicit guest. A verified but unmapped principal
is rejected rather than downgraded to anonymous. Anonymous access is limited to an explicitly public
projection. Place records allow and denial decisions through an audit port without retaining raw
tokens. Persistence and operator-authorized initial-owner bootstrap arrive with the Stage 3 schema;
browser input can never trigger bootstrap.
