# Access module

This module owns the boundary between verified external identity evidence and Place authorization.
It maps exact `(issuer, subject)` principals to Place memberships and owns roles, tiers, grants,
bootstrap/last-owner protection, access decisions, and audit-safe decision records. The initial-owner
store port commits membership creation and its audit outcome as one persistence operation.

`changeMembershipAuthorityRole` is the sole authority-role mutation interface. Administrators may
manage non-owner roles; changing an owner or promoting a member to owner requires owner authority.
The injected store must compare the observed role, protect the last active owner, apply or reject the
change, and record its outcome in one transaction. Callers receive explicit changed, unchanged,
forbidden, not-found, conflict, or last-owner-protected results and never infer success after a race.

Consumers import only `index.ts`. The domain is framework-free. Application ports are owned here;
in-memory implementations remain test-only. The Stage 3 PostgreSQL adapter accepts a caller-owned
pool and implements membership resolution, initial-owner bootstrap, access audit, and atomic role
changes without exposing SQL rows. It is source-only and is not yet wired into HTTP/Worker. Identity
adapters validate evidence but never decide Place roles. `administration` may expose management
workflows later, but it must call this module's public interface instead of recreating access rules.

Allowed dependencies are this module's inner layers and business-neutral platform security helpers.
No other business module is imported directly. Validate with `npm test --workspace @place/backend`
and the repository architecture command.
