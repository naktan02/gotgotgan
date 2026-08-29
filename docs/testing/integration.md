# Integration tests

With `PLACE_DATABASE_TEST_HOST` injected by the test environment, `npm run test:database` starts a
disposable digest-pinned PostGIS runtime with random test-only credentials and exercises the public
database preparation command twice. It proves migration
ownership, intended runtime DML, runtime denial for DDL/ownership/history mutation, PostGIS presence,
and GiST use in the query plan. It also runs the existing access use cases through the PostgreSQL
adapter and proves bootstrap/resolution, role changes, last-owner protection, central Owner
onboarding/replacement, stale-write conflict,
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

Stage 7.5 Import query suite는 회원별 batch 이력과 source-order item 상세를 실제 runtime role로
읽는다. 상태·batch에 묶인 cursor의 재사용 거부, 잘못된 회원의 not-found, 공개 projection의 내부
idempotency/profile 비노출, 분리된 cancel/resume Adapter의 회귀를 검증한다. 각 5,000행에서 Migration
`000026`의 상태별 batch index와 item 원본 순서 index가 실제 query plan에 선택되는지도 확인한다.
좁은 반복 명령은 `npm run test:import-queries`다.

Library query suite는 saved/wanted/rated pagination뿐 아니라 최대 20개 Tag ID의 `all`/`any` 조합,
Tag 순서 정규화, filter가 다른 cursor 재사용 거부를 실제 runtime role로 검증한다. 같은 suite에서
Collection rename/reorder/remove/delete, Tag rename/untag/delete와 Import provenance가 있는
Collection membership의 제거·재수집·삭제를 실행한다. Migration `000027`의 Tag-first index가 실제
query plan에 선택되는지도 확인한다. 좁은 반복 명령은 `npm run test:library-queries`다.

Personal content suite는 같은 command ID의 preference replay, stale 예상 timestamp 거부, 동일한
회원·Place에 대한 동시 최초 write 중 하나만 적용, 같은 발생 시각에서도 단조 증가하는 preference
timestamp와 중복 없는 Rating event를 실제 runtime role로 검증한다.

추가 Materialization PostGIS 수직 검증은 두 회원이 동일 NAVER Place ID를 가져왔을 때 공동 job 1개와
회원별 intent를 만들고 외부 상세 호출 없이 Source Snapshot evidence로 한 Canonical Place와 Provider
link를 생성하는지 확인한다. 각 회원 Library에는 즉시 멱등 저장하고 Provider 상세 상태는 `pending`으로
남긴다. 같은 장소를 두 원본 폴더에서 가져와도 Canonical Place와 preference는 회원별 하나이고,
Collection·list provenance·membership·item-level Source List/Item/Provider Place provenance는 원본별로
유지되는지 검증한다. 이 테스트는 module 공개 interface와 실제 least-privilege runtime role만 사용한다.

Provider detail 전용 PostGIS suite는 별도 Job을 claim하고 정규화된 상세 Observation/Candidate를
append-only로 기록한 뒤 상태를 `available`로 전환한다. attempt·lease가 완료되고 Canonical Place 수는
그대로 0인지 함께 검증해 상세 수집이 동일 장소 판정이나 Canonical mutation을 우회하지 못하게 한다.

Cross-provider Resolution suite는 NAVER 한글 이름과 Google 영문 이름을 raw language tag와 함께
보존하고, 근접 위치와 국가번호가 다른 같은 전화번호로 `likely-same` review hint를 기록한다. 같은
영문 이름이지만 멀리 떨어진 Kakao 관찰은 `likely-different`로 남긴다. 재실행은 같은 immutable
assessment를 replay하며 새 행을 만들지 않고, runtime role의 assessment update는 거부된다. 전체 흐름
뒤에도 Canonical Place 수가 0인지 확인해 Match Assessment가 link/merge 권한이 아님을 증명한다.

Shadow cluster suite는 A-B와 B-C가 `likely-same`이어도 A-C가 `likely-different`이면 A-B-C를 합치지
않는다. proposal header 2행, normalized member 3행, accepted supporting edge 1행을 확인하고 같은 graph의
재실행이 새 ID를 버리고 기존 proposal을 replay하는지 검증한다. Provider 고정 column이 0개이고,
non-member assessment foreign key 위반과 runtime update/delete가 거부되며 Canonical Place가 0개인지도
함께 확인한다.

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

Platform entitlement adapter tests generate a real ES256 assertion and verify exact audience,
principal, contract, expiry, and `owner_revision`. The real PostGIS suite proves one Owner, automatic
demotion/promotion, centrally-managed mutation denial, and audited projection. A live Identity
Backend round trip remains a separate activation test.

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
거부를 검증한다. Migration `000029` 이후 같은 suite는 private→unlisted→public 전환에서 링크 유지,
공유 해제 즉시 이전 projection 소멸, 재공개 시 새 ID, 다른 회원의 private copy와 source publication
provenance, Place 순서 외 private metadata 비복사를 실제 row lock과 runtime role로 검증한다.

Library query suite는 공개 Collection의 모든 Place ID가 기존 public summary reader에 정확히 한
batch로 전달되는지, 반환된 이름·위치·Taxonomy가 원래 순서에 결합되는지, 누락 projection이
`place: null`로 유지되는지도 별도 disposable PostGIS에서 검증한다.

로컬 검색 suite도 독립적인 disposable PostGIS runtime에 전체 migration을 적용한다. data-defined
Taxonomy의 publish/replay/conflict, 공개 Place 문서와 회원별 signal projection, text·taxonomy·bounds
filter, 불투명 cursor pagination, 익명 결과의 개인 상태 비노출과 회원 간 격리를 검증한다. 대표
부하 5,000행을 만든 뒤 `pg_trgm` GIN, geometry GiST, taxonomy array GIN이 실제 query plan에서
선택되는지도 확인한다. 테스트는 Search가 소유한 schema만 조회하며 다른 owner schema의 join을
검색 구현으로 허용하지 않는다.

Canonical Place detail suite는 Places redirect/lifecycle 해석, Search 공개 문서, Library preference,
Visits summary를 각 공개 Interface로 조립한다. 익명 응답의 개인 상태 비노출, 정상 optional bearer의
개인 상태 결합, 잘못된 bearer의 `401`, retired의 `410`을 실제 least-privilege PostGIS 위에서
검증한다. projection lag는 익명 요청의 retryable `503`과 인증된 요청의 public-fact 없는 `pending`
개인 projection을 모두 검증한다. 어느 persistence Adapter도 다른 owner schema를 join하지 않는다.

Bounded Library query suite는 saved/wanted/rated filter별 keyset pagination, filter 간 cursor 재사용
거부, Collection 목록과 membership pagination, 다른 회원 Collection의 비공개 `not-found`, Tag별
Place count, 공개 Place summary batch hydration과 projection 누락 보존을 검증한다. 대표 preference
5,000행에서 saved partial index가 실제 query plan에 선택되는지도 확인한다.

Visit/Writing query suite는 Place에 묶인 Visit cursor와 Writing kind에 묶인 cursor의 다른 용도 재사용을
거부하고, 회원별 행 격리와 1~50 limit guard를 검증한다. Visit 목록에 member/fingerprint/evidence가
없고 Writing 목록은 280자 preview만 가지며 단건 detail에서만 전체 본문을 돌려주는지도 확인한다.
각 5,000행 대표 부하에서는 member·Place·time·ID Visit index와 owner·updated-at·ID Writing index가
실제 query plan에 선택된다. Place-filtered Writing은 kind·Place에 cursor를 함께 묶고 Migration
`000028`의 Place-first link index가 선택되는지도 검증한다.

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
