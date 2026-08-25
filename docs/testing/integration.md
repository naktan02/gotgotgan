# Integration tests

Stage 3 introduces real PostGIS tests for migrations, roles, spatial indexes, isolation, backup, and
restore. Later process tests prove job lease/fencing behavior and sanitized provider replay. Unit
fakes do not substitute for protocol or database semantics at these seams.

Stage 2 tests the HTTP access seam through an injected verifier, membership directory, and audit
sink. The web tests the OIDC BFF and `openid-client` adapter with deterministic doubles, including
one-time transaction, provider rejection, expired token, secret non-disclosure, and server-side
logout paths. These do not claim a live Identity integration; real discovery/callback tests begin
only after provisioning and a durable session adapter exist.

Authority-administration tests exercise the access module interface rather than a future database
adapter. They cover administrator success, owner-only denial, last-owner protection, unauthorized
non-disclosure, optimistic conflict, and audited no-op outcomes. Stage 3 must run the same contract
against PostgreSQL and prove that role comparison, final-owner protection, mutation, and outcome
audit share one transaction.
