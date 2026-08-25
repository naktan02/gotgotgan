# ADR 0003: Place owns authorization from verified Identity evidence

- Status: Accepted
- Date: 2026-08-25

## Context

Identity is the workspace-wide login authority, while Place needs product-specific membership,
roles, tiers, resource grants, public projections, bootstrap, and last-owner rules. Copying Identity
accounts or accepting browser role values would couple the products and weaken authorization.
Anonymous public reading and deterministic local tests also need explicit behavior without creating
an implicit authenticated guest.

## Decision

The `access` module owns the boundary. An OIDC adapter verifies signature, exact issuer and audience,
time claims, required scopes, and subject. Its domain output contains only `(issuer, subject)`.
Place maps that pair to a local Membership and makes every authorization decision itself.

Authority Role (`member`, `reviewer`, `administrator`, `owner`), User Grade, and Product Tier are
independent. Grades and tiers never grant administrative authority. Explicit resource grants may add
one bounded permission. Suspended membership grants nothing, and the final active owner cannot be
demoted or suspended. ADR 0007 adds the consent-gated just-in-time creation policy for memberships.

No credential is an Anonymous Visitor and can read only an explicit Public Projection. A verified
but unmapped principal is rejected, not downgraded to anonymous. Initial-owner creation is available
only through an injected operator-authority port and an atomic empty-membership store operation;
browser input is not authority. Access and bootstrap outcomes emit audit-safe records without tokens.

Production OIDC trust anchors and audience are deployment-injected, use HTTPS, and have no repository
default. The explicit test verifier uses a deterministic token map and production configuration
rejects test mode. Place owns its OIDC client manifest, but Identity provisioning and Gateway routing
remain integration gates and do not require Place business logic in Identity.

## Consequences

- Business modules request Place permissions through consumer-owned ports and do not read token
  claims, Identity data, or access-module internals.
- `administration` owns management workflows only; it calls the access public interface.
- Membership persistence and atomic bootstrap storage are implemented with the Stage 3 Place schema.
- Public UI visibility is not authorization; APIs repeat policy checks.
- A future authenticated guest requires a separate versioned contract and ADR.

## Evidence

- `backend/src/modules/access/`
- `backend/src/modules/access/tests/`
- `docs/integrations/identity.md`
- Workspace Identity onboarding and OIDC contracts reviewed on 2026-08-25.

## Supersession

Supersede this ADR only if the workspace identity contract changes its canonical principal or a
separately owned authorization service provides a versioned, resource-aware Place contract with an
approved migration and failure model.
