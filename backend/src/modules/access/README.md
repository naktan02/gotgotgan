# Access module

This module owns the boundary between verified external identity evidence and Place authorization.
It maps exact `(issuer, subject)` principals to Place memberships and owns roles, tiers, grants,
bootstrap/last-owner protection, access decisions, and audit-safe decision records. The initial-owner
store port commits membership creation and its audit outcome as one persistence operation.

Consumers import only `index.ts`. The domain is framework-free. Application ports are owned here;
an in-memory directory is test-only and PostgreSQL persistence arrives with Stage 3. Identity
adapters validate evidence but never decide Place roles. `administration` may expose management
workflows later, but it must call this module's public interface instead of recreating access rules.

Allowed dependencies are this module's inner layers and business-neutral platform security helpers.
No other business module is imported directly. Validate with `npm test --workspace @place/backend`
and the repository architecture command.
