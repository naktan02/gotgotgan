# Place contracts

This package is the machine-readable publication boundary for Place-owned HTTP, event, Tool, and
stable reference contracts. A folder may remain documentation-only until its first contract exists.

`family-navigation` is a provisional consumer contract because the workspace composer owner is not
yet selected. Its fixture proves only that Place can render an explicitly inactive manifest.

The HTTP contract publishes source-only browser authentication, current-membership, current-consent,
membership-onboarding, and authority-role administration operations. It distinguishes browser BFF
operations from bearer-authenticated backend operations. Publication describes owned
request/response semantics; it does not declare an active Identity client, production database
composition, or Gateway route.

`deploy/application-runtime.json` is the machine-readable source-only process/exposure declaration.
It fixes Web as the future public process, keeps Backend and Worker internal, and forbids browser-to-
Backend and cross-project database connections without making a deployment active.

`membership/membership-policy.v1.schema.json` defines the deployment-owned current consent versions
and initial non-authority grade/tier values. It defines shape and bounds only; the repository contains
no production policy instance or default.

`operations/application-deployment-plan.v1.schema.json` defines the sanitized source-only activation
and rollback plan for one immutable Web/Backend application unit. `operations/database-recovery-
evidence.v1.schema.json` defines the bounded proof emitted only after disposable database-level
backup and isolated restore verification. Neither document contains environment values, credentials,
or a claim that an environment is active.

`place-reference/place-reference.v1.schema.json` publishes the stable cross-product result envelope.
Available references expose only the resolved Canonical Place ID; unavailable and redacted outcomes
contain no identifier. Stage 4 HTTP schemas likewise keep authenticated command membership outside
browser input and distinguish the two anonymous publication projections.
