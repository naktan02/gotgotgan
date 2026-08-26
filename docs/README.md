# Place documentation router

This directory is authoritative for repository-local product, architecture, domain, contracts, data,
security, testing, and operations. Workspace-wide ownership and cross-project rules remain in
`../../docs/`.

Read only the routes required by the task, after repository `AGENTS.md` and `README.md`:

- Product scope, terminology, journeys, UI, or reference work: `product/README.md`.
- Module placement, dependencies, processes, or failure behavior: `architecture/README.md`.
- Place concepts, ownership, normalization, visits, writing, sharing, or ingestion: `domain/README.md`.
- HTTP, event, Tool, or stable-reference contracts: `api/README.md` and `../packages/contracts/README.md`.
- PostgreSQL/PostGIS, migrations, isolation, retention, or recovery: `data/README.md`.
- Identity, Gateway, family navigation, maps, providers, or AI: `integrations/README.md`.
- Authorization, credentials, privacy, browser profiles, or raw captures: `security/README.md`.
- Test scope, fixtures, Playwright, or live checks: `testing/README.md`.
- Local execution, worker lifecycle, deployment, backup, or incidents: `operations/README.md`.
- A durable decision or supersession: `adr/README.md`.

Delivery state is **source-only; Stage 6.5 complete and Stage 2 integration in progress**. A Place-owned physical PostGIS runtime is
implemented and tested in disposable environments but not deployed or active. No provider account, browser profile, map credential, Identity
client, Gateway route, family composer, or AI connection is active.

Stage 7은 진행 중이다. 연결 메타데이터, durable Import queue, lease/fencing, NAVER 승인 캡처
parser, 암호화 artifact replay, preview/review API와 실제 PostGIS 검증은 source-only로 구현되었다.
실제 NAVER test account의 Playwright acquisition, profile lifecycle, Web review UI/E2E는
integration-gated이며 완료로 표시하지 않는다.

Stage 3's source foundation includes immutable ingestion evidence/candidates/decisions and
fingerprint-idempotent canonical create/link/merge/split/retire behavior with redirect and lineage
history. This does not activate a product transport or database environment.

Stage 4는 회원 소유 Library, Visits, Writing 구현과 인증된 Backend command, Web이 앞단을
소유하는 public/unlisted projection, `place-reference.v1`을 추가했다. 실제 PostGIS와
desktop/mobile Playwright 테스트로 이력 보존, Visit 파생, private field 비노출을 검증했다.
이는 Identity, Gateway, deployment flow가 활성화되었다는 의미가 아니다.

Stage 5는 data-defined Taxonomy와 Search 소유 projection을 추가했다. 로컬 text·taxonomy·bounds·
회원 signal 검색, cursor pagination, source-neutral partial 결과, responsive 목록/지도 UI를 실제
PostGIS와 Playwright로 검증했다. 결정적 지도 renderer와 test-owned 검색 fixture는 live 지도,
provider 검색 또는 공개 배포가 활성화되었다는 의미가 아니다.

Stage 6는 capability가 서로 다른 NAVER/Kakao/Google 공식 검색 adapter, bounded HTTP
timeout/retry/error 분류, source별 공정 merge와 continuation, provider/canonical identity 분리,
Google 선택 결과의 지연 상세·사진 attribution, 원문 열기를 추가했다. Redacted raw fixture replay,
Web/Backend 계약, Playwright, PostGIS, Docker 검증을 통과했지만 실제 endpoint/credential은 주입되지
않았고 provider account나 live traffic은 활성화되지 않았다. Crawlee/Playwright 수집 runtime도
아직 구현되지 않았으며 Stage 7의 실제 NAVER import 경로에서 검증한다.

Stage 6.5는 `place-search.v1`과 분리된 입력 중 후보 계약, Search 소유 session/impression/Discovery
Projection, 로컬·공급자 후보 결합, 선택 시 Ingestion observation, 개인 의도 시 Places canonical
승격을 추가했다. 실제 PostGIS는 반복 표시·선택·승격의 멱등성과 TTL 정리를 검증하고,
desktop/mobile Playwright는 stale 요청 취소, 동명 지점, 키보드 선택, 부분 장애와 수동 전체 검색
fallback을 검증한다. 실제 공급자 credential과 traffic은 여전히 비활성이다.
