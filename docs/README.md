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

Delivery state is **source-only; Stages 6.5, 7.5–7.17, and 11A–11E1 complete, with Stages 2, 7, and 11 in progress and Stage 8 paused after 8B**. A Place-owned physical PostGIS runtime is
implemented and tested in disposable environments but not deployed or active. No provider account, browser profile, map credential, Identity
client, Gateway route, family composer, or AI connection is active.

Stage 7은 진행 중이다. 연결 메타데이터, durable Import queue, lease/fencing, NAVER 승인 캡처
parser, 암호화 artifact replay, preview/review API, Web BFF와 반응형 검토 화면, 만료 artifact
물리 삭제 작업을 source-only로 구현했다. desktop/mobile Playwright와 실제 PostGIS는 검토 재시도,
민감정보 비노출, DB 삭제 표식과 암호화 파일 삭제를 검증한다. 현재 전용 Chrome profile을 사용하는
로컬 커넥터의 로그인·취소·종료, 값 없는 네트워크 구조 보고서, current·legacy NAVER schema를 격리한
전체 폴더·bookmark pagination 수집기는 source-only 진단 CLI다. 평소 로그인 session을 재사용하지
못하므로 주 회원 흐름으로 사용하지 않는다. ADR 0012는 `apps/member-connector`에 현재 browser profile을
쓰는 하나의 다중 브라우저·다중 Provider 확장을 두고 NAVER·Kakao·Google을 Adapter로 격리하도록
결정했다. Versioned Connector 계약, provider-neutral application Interface, browser/upload Adapter와
Chromium·Firefox Manifest V3 build 검증은 source-only다. Chrome·Edge·Whale은 Chromium 산출물을
공유하지만 Whale 실설치 evidence는 아직 없다. Provider host permission, 실제 Provider Adapter, 공개
BFF capture route와 Backend receiver는 NAVER에 대해 source-only로 연결됐다. grant rotation,
origin·sequence·checksum·상한 검증, 암호화 원본과 PostGIS ImportBatch 영속화도 통합 검증한다.
Kakao·Google Provider Adapter, 실제 Whale/NAVER session smoke와 서버 상세 profile Adapter는
integration-gated이며 완료로 표시하지 않는다. current·legacy parser 변화는 값이 제거된 독립 fixture로
재생하지만, 이를 새로운 live Provider 계약 관찰로 과장하지 않는다.

Provider Place ID가 안정된 item은 Source List·Item ID와 함께 `enriching` intent로 기록된다. Provider
Identity별 공동 materialization job은 기존 Canonical link를 재사용하고, 없으면 가져온 snapshot을
근거로 create/link한 뒤 회원의 private Collection에 즉시 멱등 저장한다. Provider 상세 상태와 후속
보강 Job은 이 저장 수명주기와 분리된다. Migration `000021`과 Provider-neutral Worker/PostgreSQL
Adapter는 lease·retry·immutable detail Observation/Candidate와 `pending`/`available`/`unavailable`
전이를 구현했다. 실제 NAVER 상세 경로 관찰과 read-only Adapter 활성화는 선택적 deferred work이며
관찰 자료가 제공되기 전에는 비활성으로 남지만 Stage 7 완료를 막지 않는다.

Stage 8A는 `resolution` 모듈과 Migration `000022`에서 다국어 원문을 보존하는 Provider Identity별
comparison representation, bounded PostGIS/`pg_trgm`/전화/website 후보 검색, versioned immutable
Match Assessment를 구현한다. 서로 다른 script의 이름은 false mismatch로 만들지 않고, branch/floor와
시간·거리 같은 독립 feature를 함께 기록한다. 분류는 review hint이며 Canonical mutation port가 없다.
단위·disposable PostGIS 테스트는 replay와 runtime assessment 변경 거부까지 검증한다. Migration
`000023`은 AI 없이 versioned Place Cluster Proposal, normalized member/assessment 관계와 모든
구성원 쌍의 긍정 근거를 요구하는 shadow proposer를 추가한다. 실제 평가는 두 번째 connected-account
Provider가 들어온 뒤 시작하고, web-research AI와
accepted Resolution Decision 연결은 cluster dossier와 실제 데이터 형태가 안정된 후로 미룬다.

Stage 3's source foundation includes immutable ingestion evidence/candidates/decisions and
fingerprint-idempotent canonical create/link/merge/split/retire behavior with redirect and lineage
history. This does not activate a product transport or database environment.

Stage 4는 회원 소유 Library, Visits, Writing 구현과 인증된 Backend command, Web이 앞단을
소유하는 public/unlisted projection, `place-reference.v1`을 추가했다. 실제 PostGIS와
desktop/mobile Playwright 테스트로 이력 보존, Visit 파생, private field 비노출을 검증했다.
이는 Identity, Gateway, deployment flow가 활성화되었다는 의미가 아니다.

Stage 7.11은 기존 Visits Backend 계약을 Personal Library의 선택 Place 상세에 연결한다. 같은 장소의
반복 방문은 각각 새로운 불변 occurrence이고, bounded history와 응답 유실 시 동일 요청 재전송을
desktop/mobile에서 검증한다. 브라우저는 내부 evidence나 member ID를 제출하지 않으며 Provider 수집,
AI, Product Tier UI 분기 없이 existing authorization seam을 사용한다.

Stage 7.12는 Place-filtered bounded Writing query와 private Note 생성·수정 Web 흐름을 추가한다.
브라우저 command는 visibility·publication·Entry 권한을 갖지 않고, 응답 유실 replay와 optimistic
version conflict의 초안 보존을 desktop/mobile에서 검증한다. Migration `000028`은 기존 정규화 link
table의 Place-first 조회만 보강한다.

Stage 7.13은 `writing-list.v2`로 서버 작성일과 마지막 수정일을 함께 전달하고 일반 메모 패널에서 두
시각을 구분한다. 기존 Writing 저장·revision 경계를 재사용하며 제목, 사진 첨부, Entry 작성 UI는 이
범위에 포함하지 않는다.

Stage 7.14는 2026-08-29 Google Maps와 NAVER Map의 desktop/mobile 목록·지도·상세 흐름을 다시
관찰한 뒤 Personal Library를 목록, 독립 상세, 결정적 지도 pane으로 조립했다. mobile은 목록/지도를
한 surface씩 표시하고 Place 선택 시 전체 폭 상세로 이동하며 목록 복귀 초점을 보존한다. 기존
preference, Collection/Tag, Visit, body-only private Note 계약은 그대로이며 live map SDK나 Provider
호출은 추가하지 않았다.

Stage 7.15는 Search의 debounce/cancellation, suggestion, Taxonomy, bounds, pagination, partial source,
Provider detail 계약을 바꾸지 않고 렌더링을 검색 입력, 결과 목록, 선택 상세, 지도 조립 module로
분리한다. desktop은 목록·상세·지도를 함께 조정하고 좁은 desktop은 상세 우선, mobile은 목록/지도/
상세 단일 surface와 선택 행 focus 복원을 사용한다. Provider 원문 링크, rating, 사진·정보 attribution은
선택 상세에 남으며 live map SDK와 live Provider 호출은 여전히 비활성이다.

Stage 7.16은 `PersonalPlaceDetail`에 canonical `placeId`만 전달해 Search와 Library가 인증된 개인
상세 기능을 공유한다. app 조립 계층이 Search의 renderer Interface와 Personal Library의 공개
Interface를 연결하며 feature 내부 import는 없다. 외부 Provider 결과는 canonical identity가 아니므로
이 흐름을 호출하지 않고 evidence-only로 남는다.

Stage 7.17은 Personal Library의 현재 목록 row로 marker를 만드는 결합을 제거한다. 별도 인증 지도
query가 state/Collection과 현재 Tag·지역·Taxonomy filter, bounds, zoom을 받아 viewport 안의 모든
projected member Place를 point 또는 count-bearing cluster로 표현한다. 지도는 list cursor를 소비하지
않으며, 위치 projection이 없는 scope Place 수를 명시한다. Web은 map 이동/확대 요청을 교체 취소하고
cluster 선택 시 bounds를 좁힌다. live map SDK는 활성화하지 않는다.

Stage 11A는 Stage 9·10의 Provider 작업을 기다리지 않아도 되는 Collection 공유를 먼저 연결한다.
Library 관리 화면의 private/unlisted/public 전환과 해제, 별도 `library.share` 권한 seam, 서버 발급
publication ID 수명주기, 공개 화면에서 다른 회원 private Library로의 Place 순서 복사를 구현한다.
공유 projection과 copy에는 Rating, Tag, Visit, Writing, ownership이 없고 실제 PostGIS와
desktop/mobile E2E가 해제된 링크 소멸과 copy provenance를 검증한다. 공개 profile/map discovery와
cross-product PlaceReference 소비는 Stage 11의 남은 작업이다.

Stage 11B는 공개 Collection Place 행을 versioned public Place summary로 보강한다. Library는 Search
schema를 join하지 않고 조립된 batch reader Interface만 사용한다. Web은 이름·지역·primary Taxonomy를
표시하고 projection 지연은 안전한 준비 중 상태로 나타내며, 개인 Library metadata는 계속 거부한다.

Stage 11C는 공개 정렬 목록을 기본·최대 50개 cursor page로 제한하고 전체 Place 수를 별도로 제공한다.
publication ID와 공개본 수정 버전에 묶인 cursor는 다른 공유본이나 변경된 공유본에 재사용할 수 없다.
공개 지도는 목록 page와 독립적으로 publication membership, bounds, zoom을 조회해 모든 projected
Place를 point 또는 count-bearing cluster로 표현한다. Web의 이어 읽기와 지도 요청도 서로 독립이며,
provider-neutral renderer는 app 조립 계층에서 주입된다. live map SDK는 여전히 활성화하지 않는다.

Stage 11D는 공개 Collection의 선택된 Place만 익명 상세로 지연 조회한다. Web BFF는 bearer evidence를
전송하지 않고 공개 전용 strict schema로 Backend 응답을 다시 검증해 `personalState`가 섞이면
fail closed한다. 목록 제목과 map marker는 같은 선택 identity를 사용하지만 공개 detail module은
개인 preference·Collection/Tag·Visit·Note module을 import하지 않는다.

Stage 11E1은 immutable Public Handle과 hidden/public 프로필을 추가한다. 익명 프로필은 owner identity를
제외하고 `public` Collection만 bounded cursor로 조합하며 `unlisted`는 포함하지 않는다. 외부 검색엔진
색인은 공개 프로필과 기존 공유 HTML 모두 금지한다. 전역 사람 검색, 내부 discovery index, 소셜 action,
신고 workflow, tier별 제한은 이 최소 공개 링크 단계에 포함하지 않는다.

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
