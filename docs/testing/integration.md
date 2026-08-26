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

Stage 7 전용 disposable PostGIS 검증은 connection의 불투명 참조 저장, Import 요청 재생, 작업
claim/attempt/capture/item 영속화, review create, observation/candidate/decision, Canonical provider
link, 개인 Library 저장과 최종 completed 상태를 한 흐름으로 실행한다. 공개 projection에서
profile/secret/cookie가 보이지 않고 동일 review 재실행이 replay되는지도 확인한다. 같은 수직 검증은
실제 AES-256-GCM 파일 adapter로 artifact를 저장하고 보존기한 뒤 sweep하여 파일 삭제와 DB
`deleted_at` 표식, 반복 실행의 빈 결과까지 확인한다.

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

개인 콘텐츠 전용 suite는 별도의 disposable PostGIS runtime에 migration을 적용하고 Library,
Visits, Writing public interface를 사용한다. Personal Rating 변경 이력 보존, 반복 Visit에서
최초·최근·횟수 파생, public Collection/Writing의 명시적 field 허용 목록, 여러 Place를 연결한
Entry revision의 optimistic 변경과 보존, runtime의 Visit·rating event·Writing revision 수정
거부를 검증한다.

로컬 검색 suite도 독립적인 disposable PostGIS runtime에 전체 migration을 적용한다. data-defined
Taxonomy의 publish/replay/conflict, 공개 Place 문서와 회원별 signal projection, text·taxonomy·bounds
filter, 불투명 cursor pagination, 익명 결과의 개인 상태 비노출과 회원 간 격리를 검증한다. 대표
부하 5,000행을 만든 뒤 `pg_trgm` GIN, geometry GiST, taxonomy array GIN이 실제 query plan에서
선택되는지도 확인한다. 테스트는 Search가 소유한 schema만 조회하며 다른 owner schema의 join을
검색 구현으로 허용하지 않는다.

interactive suggestion suite는 빈 Canonical DB에서 fixture provider 후보를 Discovery와 impression에만
저장하는지 확인한다. 같은 session의 반복 입력은 로컬 Discovery에서 같은 suggestion/evidence ID를
재사용하고 selection count를 한 번만 올린다. 명시적 선택은 SourceObservation 한 행만 만들며,
materialization 재시도 후에도 Candidate, ResolutionDecision, Canonical Place, provider link가 각각
한 행인지 실제 PostgreSQL에서 검증한다. 마지막으로 session/impression/Discovery TTL 정리를 확인한다.

The published-image smoke is intentionally not replaced by a local tag test. The manual release
workflow removes any local copies, pulls both exact GHCR platform digests, checks non-root and
source-revision labels, starts Web and Backend in their source-only modes, waits on both `/readyz`
interfaces, and invokes the Worker check from the Backend digest. Its bounded JSON result is uploaded
separately from the four SBOM/provenance evidence artifacts. Until a remote run succeeds, this is a
tested publication procedure rather than retained publication evidence.
