# Integration tests

With `PLACE_DATABASE_TEST_HOST` injected by the test environment, `npm run test:database` starts a
disposable digest-pinned PostGIS runtime with random test-only credentials and exercises the public
database preparation command twice. It proves migration
ownership, intended runtime DML, runtime denial for DDL/ownership/history mutation, PostGIS presence,
and GiST use in the query plan. It also runs the existing access use cases through the PostgreSQL
adapter and proves bootstrap/resolution, role changes, last-owner protection, stale-write conflict,
malformed-ID non-disclosure, and mutation/audit rollback. `npm run test:database-recovery` supplies
the separate recovery seam. It uses two independently credentialed disposable runtimes, takes a
custom-format Place database dump, restores it in isolation, and verifies credential rotation,
database isolation, PostGIS/index/canonical data, runtime DDL denial, encrypted browser payloads,
and matching-key session recovery.
The same disposable runtime creates two independent Web OIDC process compositions and proves atomic
cross-pool transaction consumption, encrypted-at-rest token sessions, cross-instance restoration,
replay denial, logout deletion, and runtime denial of session updates.
Later process tests prove job lease/fencing behavior and sanitized provider replay. Unit fakes do not
substitute for protocol or database semantics at these seams.

Stage 2 tests the HTTP access seam through an injected verifier, membership directory, and audit
sink. The web tests the OIDC BFF and `openid-client` adapter with deterministic doubles, including
one-time transaction, provider rejection, expired token, secret non-disclosure, and server-side
logout paths. Browser membership tests prove session-owned bearer forwarding, strict response
projection, fixed backend paths, and fail-closed runtime behavior. These do not claim a live Identity
integration; real discovery/callback/onboarding tests begin only after provisioning.

Authority-administration unit tests and the real PostGIS suite exercise the same access module
interface. They cover administrator success, owner-only denial, last-owner protection, unauthorized
non-disclosure, optimistic conflict, and mutation/audit atomicity. Production pool composition and
browser-session persistence now have source and real-PostgreSQL evidence; route activation and live
Identity/Gateway protocol evidence remain separate work.

The same real PostGIS suite constructs the production Backend runtime through its public process
interface. It proves initial readiness, current-consent publication, verifier injection, membership
creation, `/v1/me` resolution, server-token non-disclosure, and runtime-owned close using the least-
privilege Pool. Web readiness tests aggregate activated OIDC and Backend dependencies; source-only
Playwright confirms disabled optional integrations remain ready without claiming a live Identity
flow.

The database command also runs a dedicated canonical-resolution suite. It records provider-neutral
observations, candidates, and decisions through the ingestion module interface, then exercises
create, merge, redirect resolution, split, provider-identity resolution, retirement, replay,
conflicting ID reuse, and concurrent provider-link decisions through the places interface. Direct
runtime-role checks prove evidence, decisions, redirects, and lineage cannot be rewritten or deleted.

The focused personal-content suite applies migrations in another disposable PostGIS runtime and
uses the public Library, Visits, and Writing interfaces. It proves Personal Rating changes retain
history, repeated Visits derive first/last/count, public Collection and writing projections use
explicit field allowlists, multi-Place Entry revisions are optimistic and retained, and the runtime
cannot rewrite Visits, rating events, or writing revisions.

The published-image smoke is intentionally not replaced by a local tag test. The manual release
workflow removes any local copies, pulls both exact GHCR platform digests, checks non-root and
source-revision labels, starts Web and Backend in their source-only modes, waits on both `/readyz`
interfaces, and invokes the Worker check from the Backend digest. Its bounded JSON result is uploaded
separately from the four SBOM/provenance evidence artifacts. Until a remote run succeeds, this is a
tested publication procedure rather than retained publication evidence.
