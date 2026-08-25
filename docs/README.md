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

Delivery state is **source-only; Stage 5 complete and Stage 2 integration in progress**. A Place-owned physical PostGIS runtime is
implemented and tested in disposable environments but not deployed or active. No provider account, browser profile, map credential, Identity
client, Gateway route, family composer, or AI connection is active.

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
