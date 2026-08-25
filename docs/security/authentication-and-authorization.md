# Authentication and authorization

Place validates token signature, issuer, audience, time claims, and required scope, then resolves a
local membership from `(issuer, subject)`. Member, reviewer, administrator, and owner are Place roles;
subscription or product tier is a separate axis. Every resource operation enforces Place policy and
last-owner protection where applicable.
