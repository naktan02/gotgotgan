# Integration tests

With `PLACE_DATABASE_TEST_HOST` injected by the test environment, `npm run test:database` starts a
disposable digest-pinned PostGIS runtime with random test-only credentials and exercises the public
database preparation command twice. It proves migration
ownership, intended runtime DML, runtime denial for DDL/ownership/history mutation, PostGIS presence,
and GiST use in the query plan. It also runs the existing access use cases through the PostgreSQL
adapter and proves bootstrap/resolution, role changes, last-owner protection, stale-write conflict,
malformed-ID non-disclosure, and mutation/audit rollback. Backup and isolated-restore evidence remains a separate Stage 3 gate.
The same disposable runtime creates two independent Web OIDC process compositions and proves atomic
cross-pool transaction consumption, encrypted-at-rest token sessions, cross-instance restoration,
replay denial, logout deletion, and runtime denial of session updates.
Later process tests prove job lease/fencing behavior and sanitized provider replay. Unit fakes do not
substitute for protocol or database semantics at these seams.

Stage 2 tests the HTTP access seam through an injected verifier, membership directory, and audit
sink. The web tests the OIDC BFF and `openid-client` adapter with deterministic doubles, including
one-time transaction, provider rejection, expired token, secret non-disclosure, and server-side
logout paths. These do not claim a live Identity integration; real discovery/callback tests begin
only after provisioning and a durable session adapter exist.

Authority-administration unit tests and the real PostGIS suite exercise the same access module
interface. They cover administrator success, owner-only denial, last-owner protection, unauthorized
non-disclosure, optimistic conflict, and mutation/audit atomicity. Production pool composition and
browser-session persistence now have source and real-PostgreSQL evidence; route activation and live
Identity/Gateway protocol evidence remain separate work.
