# Access module

This module owns the boundary between verified external identity evidence and Place authorization.
It maps exact `(issuer, subject)` principals to Place memberships and owns protected Authority Roles,
data-defined User Grades, Product Tiers, grants, consent-gated onboarding, bootstrap/last-owner
protection, access decisions, and audit-safe decision records. User Grade and Product Tier never
grant administrative authority.

`completeMembershipOnboarding` is the sole self-service membership-creation interface. It requires
the exact current server-selected consent set and always constructs the non-elevated `member` role.
Its store port atomically creates or resolves the unique principal mapping, records versioned consent,
and appends an audit outcome. Retries preserve an existing status, role, grade, and tier. Login and
token verification do not call this interface implicitly. The initial-owner store port separately
commits operator-authorized membership creation and its audit outcome as one persistence operation.

`changeMembershipAuthorityRole` is the sole authority-role mutation interface. Administrators may
manage non-owner roles; changing an owner or promoting a member to owner requires owner authority.
The injected store must compare the observed role, protect the last active owner, apply or reject the
change, and record its outcome in one transaction. Callers receive explicit changed, unchanged,
forbidden, not-found, conflict, or last-owner-protected results and never infer success after a race.

Consumers import only `index.ts`. The domain is framework-free. Application ports are owned here;
in-memory implementations remain test-only. The Stage 3 PostgreSQL adapter accepts a caller-owned
pool and implements membership resolution, atomic onboarding/consent, initial-owner bootstrap,
access audit, and atomic role changes without exposing SQL rows. It is source-only and onboarding is
not yet wired into HTTP/Worker. Identity adapters validate evidence but never decide Place roles or
grades. `administration` may expose management workflows later, but it must call this module's public
interface instead of recreating access rules.

Allowed dependencies are this module's inner layers and business-neutral platform security helpers.
No other business module is imported directly. Validate with `npm test --workspace @place/backend`
and the repository architecture command.
