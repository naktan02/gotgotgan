# Place

Shared domain terminology is defined in [`CONTEXT.md`](CONTEXT.md). Detailed documentation starts at
[`docs/README.md`](docs/README.md).

Place is an independent personal place platform for provider-neutral place identity, source
evidence, personal libraries, visits, writing, imports, sharing, and future Tool access.

Current delivery state: **source-only; Stages 6.5 and 7.5–7.12 complete, Stages 2 and 7 in progress, and Stage 8 paused after 8B**. Independent web/backend composition
roots, Place access policy/OIDC adapters, contracts, architecture checks, deterministic shell tests,
a source-only physical PostGIS declaration, a tested database preparation/migration command, and
access-owned membership/consent plus encrypted browser-auth PostgreSQL persistence exist. Protected
Web OIDC secret-file loading, fail-closed Next startup installation, periodic bounded expiry cleanup,
signal-owned pool closure, and reviewed fail-closed browser auth handlers also exist as source-only
platform interfaces. Strict backend transports publish current consents, consent-gated onboarding,
and audited authority-role administration. The Web BFF owns browser consent/onboarding routes and a
fixed server-to-server backend client so access tokens remain outside browser payloads. These routes
fail closed or remain unregistered until their process dependencies are explicitly supplied. A
source-only production backend composition now loads protected database/policy configuration,
installs OIDC verification and PostgreSQL access adapters, owns readiness and shutdown, and registers
all reviewed access transports. Web readiness aggregates only explicitly activated OIDC and Backend
dependencies. A disposable two-runtime recovery rehearsal now proves database-level backup,
isolated restore, rotated database credentials, PostGIS/index restoration, runtime DDL denial, and
matching browser-session key recovery. Production Compose consumes only injected digest image
references; local Compose alone owns builds, and a source-only planner validates activation and
application-only rollback units. A manual producer-owned release workflow now gates on successful
same-commit CI, publishes separate immutable Web and Backend GHCR images, validates their BuildKit
SBOM/provenance, smokes only the published platform digests, and emits one `release-record.v1`.
The workflow supports fail-closed recovery from either partial or completed commit-tag publication,
but no successful remote release run or deployment is claimed yet. There is no active application environment, provider account, map credential,
Identity client, Gateway route, or AI Tool connection.

The Stage 3 canonical foundation now records immutable Source Observations, normalized Place
Candidates, and evidence-backed Resolution Decisions separately from canonical mutation. Canonical
create/link/merge/split/retire commands are fingerprint-idempotent, preserve provider identity links,
redirects, and lineage, and are verified against real PostGIS with least-privilege runtime denial.
No HTTP or Worker transport exposes these internal module interfaces yet.

Stage 4 개인 콘텐츠 기반은 각자 schema와 PostgreSQL adapter를 소유하는 `library`, `visits`,
`writing` 모듈로 구성된다. 저장·가고 싶음 preference와 소수 단위 Personal Rating은 서로
분리하고, Rating 변경과 Writing revision은 비공개 이력으로 보존한다. 방문 여부는 변경
불가능하고 반복 가능한 Visit에서만 파생한다. 인증된 제품 command는 검증된 bearer
evidence에서 membership을 구하며, public·unlisted Collection/Writing 조회는 Web 서버를
통해 별도의 허용 목록 projection을 사용한다. `place-reference.v1`은 database 접근 없이
`available`, `unavailable`, `redacted` cross-service 결과를 제공한다.

Stage 5 로컬 검색은 data-defined Taxonomy, Search 소유 read projection, `pg_trgm` text·PostGIS
bounds·taxonomy·회원 signal filter, 불투명 cursor와 source별 partial 결과를 제공한다. Search는
다른 모듈 schema를 join하지 않고 versioned projection command로 전달된 최소 사실만 조회한다.
Web은 debounce·교체 요청 취소·목록/지도 선택·명시적 영역 재검색·pagination·mobile 전환과
loading/partial/empty/error 상태를 구현했다. 현재 지도는 실제 좌표 interaction을 검증하는
결정적 renderer이며 live tile 연결과 live provider traffic은 아직 활성화하지 않는다.

Stage 6 공식 검색은 별도 Providers 모듈에서 NAVER Local, Kakao Local, Google Places API
(New)를 구현한다. endpoint와 credential은 deployment/secret-file 주입만 허용하고, 공통 HTTP
runner는 redirect 거부, 응답 크기, timeout, bounded retry와 안전한 오류만 소유한다. 각 공급자
parser, pagination, 좌표와 누락 필드는 공급자 폴더 안에 남는다. 외부 결과는 canonical Place로
가장하지 않으며 Google만 선택 시 Details/Photo를 지연 조회해 provider rating과 attribution을
표시한다. 이는 fixture-tested source-only capability이며 live provider나 live tile map 활성화가
아니다.

Stage 6.5는 기존 `place-search.v1`을 바꾸지 않고 입력 중 후보용 `place-suggestions.v1`을
추가했다. Search가 짧은 suggestion session, impression, 재구축 가능한 Discovery Projection을
소유하고 로컬 canonical/Discovery 후보와 독립 공급자 adapter 결과를 공정하게 합친다. 후보 표시는
공용 Place나 별칭을 만들지 않으며, 명시적 선택만 Ingestion observation을 기록한다. 개인 기능에
안정된 ID가 필요할 때는 Candidate와 ResolutionDecision을 거쳐 Places command로 멱등 승격한다.
Web은 교체 요청 취소, 키보드·모바일 선택, 동명 지점 구분, 부분 장애와 전체 검색 fallback을
지원한다. 이 기능도 source-only이며 live credential, 선수집 corpus, browser automation을
활성화하지 않는다.

Stage 7은 연결 목록의 안정된 Provider Place ID와 Source List·Item ID를 보존하고, 가져온 snapshot을
Provider Identity별 공동 작업에서 Canonical Place와 회원의 private Collection에 즉시 멱등 반영한다.
상세 보강은 개인 저장과 독립된 `pending`/`available`/`unavailable` 상태로 관리하며 `available`은 정규화된 관찰을
반드시 참조한다. Migration `000021`과 별도 Provider Detail Job은 claim/lease/retry, immutable
Observation/Candidate, 최종 상태 전이를 소유하며 실제 PostGIS에서 검증됐다. 실제 NAVER 상세 경로
관찰과 read-only Adapter 활성화는 아직 integration-gated다. 가져온 장소는
상세 대기 중에도 NAVER·Google Maps·카카오맵에서 열 수 있다.
회원 PC용 `apps/member-connector`는 현재 로그인된 browser profile을 재사용하는 하나의 다중
브라우저·다중 Provider 확장으로 진행한다. NAVER·Kakao·Google은 Provider Adapter로 격리하고
일회성 grant로만 캡처를 제출한다. Versioned handshake/grant/batch/receipt 계약, provider-neutral
수집 application Interface, WebExtensions Adapter, 고정 공개-origin upload Adapter와 Chromium·Firefox
Manifest V3 build 검증은 source-only로 구현했다. Chrome·Edge·Whale은 Chromium 산출물 하나를
공유하지만 실제 Whale 설치는 아직 검증하지 않았다. 실제 Provider Adapter·host permission·공개 BFF
route와 Backend grant/capture receiver·ImportBatch 연결은 NAVER에 대해 source-only로 구현했다. grant
token digest, origin·sequence·상한·checksum, 암호화 원본, 정규화 Item과 Fulfillment intent를 실제
PostGIS로 검증했다. 실제 Whale 설치와 로그인된 NAVER session smoke는 아직 남아 있다. 기존 전용
Chrome profile 로그인, 비식별 관찰과 NAVER 전체 pagination 수집은 진단·fixture/replay·E2E·fallback으로만 남긴다.

Stage 8A는 Backend 내부 `resolution` 모듈과 Migration `000022`를 추가한다. Provider Place Identity별
최신 관찰을 다국어 원문 보존 comparison representation으로 투영하고, PostGIS 거리·`pg_trgm`
이름/주소·전화·website host로 후보를 제한한다. script가 다른 이름은 불일치가 아니라 미확정으로
두며 거리, 전화, branch/floor, 관찰 시점 등을 독립 feature로 평가한다. 결과는 변경 불가능한
policy-versioned Match Assessment와 review hint일 뿐 Canonical Place를 생성·연결·병합하지 않는다.
단위 테스트와 disposable PostGIS 수직 테스트는 다국어 비교, 먼 동명 장소, replay, least-privilege
거부를 검증한다. Stage 8B는 Migration `000023`으로 Place Cluster Proposal·member·assessment 관계를
정규화하고, 모든 구성원 쌍이 `likely-same`일 때만 합치는 AI 없는 shadow cluster proposer를 추가한다.
결과의 Provider cell은 동적 read projection이며 고정 Provider column이나 Canonical mutation이 없다.
실제 cross-provider 정확도와 AI 검증은 두 번째 연결 계정 Provider의 실제 관찰 흐름이 생긴 뒤에만
진행한다.

Stage 7.5의 첫 수직 조각은 `GET /v1/places/{placeId}`를 제공한다. 익명 요청에는 Canonical Place의
이름·지역·좌표·Taxonomy·evidence freshness만 반환하고, 검증된 optional bearer 요청에는 Library의
저장/가고 싶음/개인 평점과 Visits의 반복 방문 요약을 추가한다. redirect는 active Canonical Place로
해석하고 retired는 `410`, 아직 공개 검색 문서가 투영되지 않은 Place는 retryable `503`이다. 이
조립은 module Interface에서만 이뤄지고 Product Tier나 token은 feature module로 전달되지 않는다.
두 번째 조각은 `GET /v1/library/places`, `/collections`, `/collections/{collectionId}`, `/tags`로
회원 Library를 bounded cursor page로 제공한다. saved/wanted/rated 상태는 권위 있는 Library row에서
읽고 목록 카드용 공개 Place summary는 배치 주입한다. Library Adapter는 Search schema를 join하지
않으며 projection이 늦은 저장 기록도 `place: null`로 보존한다.
세 번째 조각은 `GET /v1/places/{placeId}/visits`, `GET /v1/writing`,
`GET /v1/writing/{documentId}`를 bounded owner projection으로 교체한다. Visit history는 내부
fingerprint/evidence를 숨기고, Writing list는 kind별 최대 50개와 280자 preview만 반환하며 전체 본문은
소유자 단건 detail에서만 읽는다. 각 query Adapter는 자기 schema만 읽고 기존 immutable Visit,
optimistic Writing revision, private/public visibility 규칙은 command/publication 경계에 남긴다.
네 번째 조각은 `GET /v1/imports`와 paginated `GET /v1/imports/{batchId}`다. 이력은 상태별 최대
50개, 상세는 Provider 원본 목록·항목 순서대로 최대 200개를 반환하며 cursor를 filter/batch에 묶는다.
조회, cancel/resume, review transaction은 각각 `PostgresImportQueries`,
`PostgresImportManagement`, `PostgresImportReview`로 분리했다. Migration `000026`과 disposable
PostGIS 검증이 회원 격리, cursor 오용 거부, 내부 참조 비노출, 대량 행 index 선택을 확인한다.
마지막 7.5 조각은 Backend와 Web의 실제 route를 생성 OpenAPI와 자동 대조한다. 모든 JSON 성공
응답은 owner가 작성한 versioned schema를 사용하고, 모든 공개 오류는 공통 Problem 계약을 사용한다.
장소·검색의 optional-member 해석과 필수 회원 인증은 공통 Product Authorizer 경계로 모였으며,
중단·등급 거부·인증 서비스 장애를 feature module 수정 없이 판정할 수 있다. 사용되지 않던 unbounded
`GET /v1/library` HTTP route는 제거됐고 내부 Library Interface만 유지한다. Import Web BFF는 batch
detail cursor/limit와 `nextCursor`를 보존한다. Google/Kakao 연결 수집, Provider 상세, AI 검증은 이
완료 조건에 포함되지 않는다.

Stage 7.6은 Personal Library의 수동 조직 기능을 완성한다. `library-place-list.v3`는 saved/wanted/rated
목록에 최대 20개의 Tag ID를 `all`/`any`로 결합하고, 저장 장소에서 파생한 지역·Taxonomy key를
각각 최대 10개까지 더해 cursor를 전체 filter에 묶는다. Collection은
순서가 있는 목록으로 이름 변경·Place 추가/이동/제거·삭제를, Tag는 다대다 분류로 이름 변경·부착/
해제·삭제를 같은 멱등 command 경계에서 제공한다. Migration `000027`은 Tag-first index, transaction
내 순서 재배치, owner-scoped 삭제와 Import provenance 정리를 지원한다. 이 기능은 Google/Kakao,
Provider 상세, AI 자동 분류나 프론트 화면 없이 독립적으로 동작한다.

Stage 7.8 후속 조각은 `library-place-facets.v1`을 추가한다. 전역 카테고리 master가 아니라 현재 회원의
saved Place ID를 최대 2,000개까지 public Place summary와 조합해 지역·provider-neutral primary
Taxonomy별 count를 만든다. 응답은 표본·projection coverage와 완전 여부를 명시하며 Library와 Search
schema를 직접 join하지 않는다. 지역명 표기가 서로 다른 경우를 임의로 합치거나 AI로 분류하지 않는다.

Stage 7.9는 선택한 Place의 저장·가고 싶음·Personal Rating을 Web에서 직접 수정한다. 기존
`set-place-preferences` command는 세 값의 최종 목표 상태와 `expectedUpdatedAt`을 함께 요구하며,
같은 `commandId` 재전송은 한 번만 적용한다. PostgreSQL Adapter는 회원·Place별 write를 직렬화하고
`updated_at`을 단조 증가시켜 다른 기기의 변경을 409로 보고할 뿐 덮어쓰지 않는다. 이 경로도
`library.write` 권한 뒤에 있고 Provider, AI, 전역 지역 identity를 요구하지 않는다.

Stage 7.10은 Personal Library에 탐색과 분리된 `목록·태그 관리` 모드를 추가한다. 회원은 비공개
Collection과 Tag를 만들고 이름을 바꾸거나 삭제하며, Collection 안 Place를 이웃 위치 기준으로
재정렬하거나 목록에서 제거할 수 있다. 응답 유실은 동일 command ID와 payload로 재시도하고,
Collection·Tag·재시도 구현은 하나의 관리 Interface 뒤의 내부 seam으로 분리한다. 이 작업은 Place
소유 데이터만 변경하며 NAVER·Google·Kakao의 원본 저장 목록이나 즐겨찾기를 수정하지 않는다.

Stage 7.11은 선택한 Place 상세에 반복 가능한 불변 Visit 기록과 bounded history를 연결한다. 과거 또는
현재의 방문 시각을 새 occurrence로 추가하며 같은 장소의 이전 방문을 수정하거나 덮어쓰지 않는다.
응답 결과를 잃으면 같은 Visit ID와 payload로만 재시도한다. 브라우저 계약은 `id`, `placeId`,
`visitedAt`만 허용하고 내부 수집용 evidence나 member ID는 받지 않는다. same-origin Visits Adapter와
내부 workflow가 인증, 재시도, pagination을 숨기며 Provider, AI, Product Tier 분기는 추가하지 않는다.

Stage 7.12는 선택한 Place의 짧은 private Note를 만들고 optimistic version으로 편집한다. Writing 목록은
optional `placeId` filter와 filter-bound cursor를 지원하고 Migration `000028`은 정규화된 Place link의
역방향 조회 index를 추가한다. 브라우저는 Entry, visibility, publication ID를 command에 넣을 수 없고
서버 Adapter가 private을 고정한다. 응답 유실은 동일 command로 재시도하며 version conflict에서는
사용자 초안을 보존한 채 명시적으로 최신 내용을 불러온다.

Stage 7.13은 일반 메모의 서버 작성일과 마지막 수정일을 목록·선택 패널에서 구분한다. 기존 Writing
table과 revision 이력을 그대로 사용하므로 새 migration이나 미디어 저장소는 없다. 일반 메모에는
제목·사진 첨부·블로그형 편집기를 추가하지 않는다.

## Repository boundaries

```text
apps/web/                  Next.js product surface
apps/member-connector/     cross-browser multi-provider extension source plus diagnostic CLI
backend/                   TypeScript HTTP/worker/module boundary
packages/contracts/        owner-controlled machine-readable contracts
tests/                     repository-wide architecture, contract, integration, and E2E tests
docs/                      routed product, architecture, domain, API, data, security, and operations docs
deploy/                    source-only deployment declarations; no active public route
```

Read [`docs/README.md`](docs/README.md) before working. In the assembled workspace, the handoff plan
is `../plans/place-platform-service-implementation.md`; it is intentionally not a repository-local
link because a standalone Place checkout must remain self-contained.

## Validation

After dependencies are installed and locks are current:

```powershell
npm run check
```

Narrow commands:

```powershell
npm run check:web
npm run check:backend
npm run check:member-connector
npm run check:contracts
npm run test:deployment
npm run test:database
npm run test:canonical-resolution
npm run test:personal-content
npm run test:local-search
npm run test:place-detail
npm run test:library-queries
npm run test:visit-writing-queries
npm run test:import-queries
npm run test:place-suggestions
npm run test:provider-place-details
npm run test:place-identity-resolution
npm run test:place-cluster-proposals
npm run test:database-recovery
npm run test:e2e
```

`test:database` requires Docker plus an injected `PLACE_DATABASE_TEST_HOST` and runs the broad
runtime suite and focused canonical-resolution, personal-content, local-search, place-detail, library-query,
Visit/Writing-query, Import-query, provider-detail, and
cross-provider identity-resolution suites serially in disposable, randomly credentialed PostGIS
containers. `test:canonical-resolution` and `test:place-identity-resolution` are narrow iteration commands. The database tests
remain separate from the default source check while Docker-enabled CI owns them.
`test:database-recovery` uses the same injected host and two
disposable runtimes; it leaves no dump, credential file, volume, or container behind.

The repository does not require sibling repositories at runtime or test time.
