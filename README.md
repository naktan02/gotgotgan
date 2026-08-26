# Place

Shared domain terminology is defined in [`CONTEXT.md`](CONTEXT.md). Detailed documentation starts at
[`docs/README.md`](docs/README.md).

Place is an independent personal place platform for provider-neutral place identity, source
evidence, personal libraries, visits, writing, imports, sharing, and future Tool access.

Current delivery state: **source-only; Stage 6.5 complete, with Stages 2 and 7 in progress**. Independent web/backend composition
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

Stage 7은 연결 목록의 안정된 Provider Place ID를 `enriching` Intent로 기록한다. Provider Identity별
공동 Fulfillment Job은 Canonical cache를 먼저 확인해 기존 장소면 외부 요청 없이 회원 Library에
저장하고, 미등록 장소만 주입된 서버 상세 Adapter로 보강한다. 동일 장소를 여러 회원이 요청해도
상세 호출과 Canonical 생성은 한 번이며 각 Library 저장은 멱등이다. 실제 사용자 PC Connector,
NAVER 내부 요청, 서버 profile Adapter와 production Worker 활성화는 아직 integration-gated다.
회원 PC용 `apps/member-connector`는 현재 로그인된 browser profile을 재사용하는 하나의 다중
브라우저·다중 Provider 확장으로 진행한다. NAVER·Kakao·Google은 Provider Adapter로 격리하고
일회성 grant로만 캡처를 제출한다. Versioned handshake/grant/batch/receipt 계약, provider-neutral
수집 application Interface, WebExtensions Adapter, 고정 공개-origin upload Adapter와 Chromium·Firefox
Manifest V3 build 검증은 source-only로 구현했다. Chrome·Edge·Whale은 Chromium 산출물 하나를
공유하지만 실제 Whale 설치는 아직 검증하지 않았다. 실제 Provider Adapter·host permission·공개 BFF
route·ImportBatch 연결도 아직 없다. 기존 전용 Chrome profile 로그인, 비식별 관찰과 NAVER 전체
pagination 수집은 진단·fixture/replay·E2E·fallback으로만 남긴다.

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
npm run test:place-suggestions
npm run test:database-recovery
npm run test:e2e
```

`test:database` requires Docker plus an injected `PLACE_DATABASE_TEST_HOST` and runs the broad
runtime suite and focused canonical-resolution, personal-content, and local-search suites serially in disposable, randomly credentialed
PostGIS containers. `test:canonical-resolution` is the narrow iteration command. The database tests
remain separate from the default source check while Docker-enabled CI owns them.
`test:database-recovery` uses the same injected host and two
disposable runtimes; it leaves no dump, credential file, volume, or container behind.

The repository does not require sibling repositories at runtime or test time.
