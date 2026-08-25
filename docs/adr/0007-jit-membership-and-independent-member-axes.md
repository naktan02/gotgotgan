# ADR 0007: Create memberships just in time and keep member axes independent

- Status: Accepted
- Date: 2026-08-25

## Context

Identity authenticates every platform principal, but Place must not pre-create a row for every
Identity account. Place also needs administrative authority, ordinary member classification, and
commercial entitlement without allowing one kind of grade to imply another. Login alone is not
evidence that a person accepted the Place service documents.

## Decision

Place creates a Membership only when a verified External Principal explicitly accepts every
server-selected current Membership Consent document. The onboarding application interface compares
the submitted document/version set with injected current policy, then asks one store operation to
create or resolve the Membership, persist the accepted versions, and append an audit outcome in one
transaction. The `(issuer, subject)` uniqueness constraint makes retries and concurrent requests
idempotent. An existing Membership is returned without changing its status or classifications.

New self-service Memberships always receive Authority Role `member` inside the use case. The client
cannot submit an Authority Role. Initial User Grade and Product Tier are injected service policy;
neither is an administrative permission. The three axes are independent:

- Authority Role is the small protected authorization set used to derive administrative permissions.
- User Grade is a data-defined Place member classification for participation, reputation, or benefits.
- Product Tier is a data-defined commercial feature or quota classification.

Use cases authorize Place permissions, not User Grade or Product Tier names. New grade/tier values
therefore do not require authorization branches. Adding or changing a protected Authority Role does
require an explicit code, schema, contract, and security review.

Anonymous visitors still use only explicit public projections. A verified but unmapped principal is
not silently downgraded to anonymous and is not registered by login or token validation alone.
Identity and Gateway require no business-logic change for this decision.

## Consequences

- Place stores rows only for people who enter the Place membership flow and accept current documents.
- Onboarding retry cannot grant elevated authority or overwrite an existing status, grade, or tier.
- Consent versions remain queryable independently of the Membership row and can support later
  re-consent without changing Identity.
- Public-preview versus members-only route policy remains a Place transport/application concern.
- Administrator management and ordinary member-grade policy can evolve without sharing mutation APIs.

## Evidence

- `CONTEXT.md`
- `backend/src/modules/access/`
- `backend/migrations/000004_add_membership_onboarding.ts`
- `docs/security/authentication-and-authorization.md`

## Supersession

Supersede this ADR only if Identity adopts a versioned platform contract that authoritatively owns
service enrollment and consent for Place, or if a separately owned authorization service exposes a
resource-aware Place contract with an approved migration and failure model.
