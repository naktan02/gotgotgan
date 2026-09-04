# Module boundaries

Backend business capabilities live at `backend/src/modules/<module>`. Each module may contain
`domain`, `application`, `adapters`, `transport`, and `tests`; it creates only leaves it uses.

The module interface is the caller and test surface. Domain rules remain framework-free.
Persistence stays at `<module>/adapters/persistence`, not a global repository bucket. Provider-specific
HTTP, structured-web, browser, parser, and outbound-sync adapters stay under the providers module.

Entrypoints compose modules and own processes. They do not decide canonical identity, authorization,
retry policy, or merge outcomes.

`access` owns principal-to-membership resolution and Place authorization. `administration` may call
its public interface for management workflows but must not recreate role, tier, grant, bootstrap, or
last-owner rules. Business modules never import another module's internal files; composition injects
public interfaces at entrypoints.

`ingestion` owns immutable observations, candidates, and accepted evidence-backed decisions.
`resolution` owns replaceable current Place Evidence Representations, bounded cross-provider candidate
blocking, immutable versioned Match Assessments, and normalized immutable shadow Place Cluster
Proposals. Its deep Interface hides complete-pair merge checks and persistence; dynamic Provider cells
are a read projection rather than stored columns. It receives evidence through its public interface,
does not query Ingestion tables, and exposes no canonical mutation port. `places` owns canonical identity
changes and reference resolution. Their handoff remains deliberately two-step and idempotent:
composition may translate only an accepted Ingestion decision into a canonical command. This avoids
direct module imports and permits comparison/review retry without treating an assessment as truth.

Stage 7에서 Ingestion은 연결 계정 Import 상태와 작업 실행 port를, Providers는 NAVER 캡처 해석을
소유한다. 두 모듈은 서로의 내부 파일을 import하지 않는다. composition root가 구조적으로 호환되는
NAVER source를 `ConnectedPlaceSource`에 주입한다. 검토용 Canonical·Library consumer port도
entrypoint에서 각 소유 모듈의 공개 interface와 연결한다.

`apps/member-connector`는 Backend 모듈이나 Docker service가 아니라 회원 PC의 별도 composition
boundary다. 목표 구조에서 application은 Provider-neutral `SavedPlaceSource`, `ProviderSession`,
`CaptureSubmission` Interface만 알고, `adapters/providers/<provider>`가 endpoint·schema·pagination을,
`adapters/browser/webextensions`가 tab·permission·message·resource lifecycle을,
`adapters/place/capture-upload`이 일회성 grant 제출을 구현한다. Extension과 CLI entrypoint는 조립만
한다. `packages/contracts/connector`가 versioned network/message contract를 소유하되 Connector는
`backend`나 `apps/web` source를 import하지 않는다. 이 의존 방향은 아키텍처 가드로 검증한다.

NAVER folder/bookmark schema와 전체 pagination은 `adapters/providers/naver/api`의 깊은 leaf가 소유하며
실행 호스트와 진단 CLI가 같은 collector를 조립한다. `acquisition/adapters/playwright`는 first-party fetch와
전용 context 수명주기를 소유하는 진단 Adapter다. 전용 profile은 평소 로그인 session을 재사용하지
못하므로 주 회원 경계가 아니라 Playwright 진단·fixture/replay·E2E·통제된 fallback으로 남긴다.
snapshot 제출은 이 Adapter나 Backend source를 직접 import하지 않고 versioned connector 계약으로 연결한다.

Backend의 Connector 수신도 Ingestion 안에서 깊은 interface 하나로 닫는다. HTTP와 production
composition은 `issueGrant`와 `submitCapture`만 호출하고, Postgres operation/receipt, 암호화 artifact,
Provider-neutral parser port는 내부 조립 세부사항이다. production composition만 Providers 공개
`parseNaverSavedPlaceCapture`를 parser port로 바꾸며 Ingestion은 Providers 내부 경로를 역참조하지 않는다.

NAVER·Kakao·Google은 독립 Provider Adapter이며 실행 호스트의 차이는 Provider leaf로 역류하지 않는다.
확장·desktop shell·향후 browser-control은 같은 application Interface를 조립할 수 있지만 검증 전
capability로 선언하지 않는다. Stage 10 외부 저장은 Import용 Source를 비대하게 만들지 않고 별도
`SavedPlaceTarget` Interface를 사용한다. ADR 0024가 이 경계를 고정한다.

Ingestion은 Provider Identity별 공동 Materialization Job과 회원별 Intent도 소유한다. 이 깊은 module
interface는 Source Snapshot evidence 기록, Canonical lookup/create/link, Library fan-out을 한 작업
수명주기로 감춘다. Places와 Library는 기존 공개 port로만 주입된다. 별도 Provider Place Detail Job
interface는 claim/lease/retry와 Observation·Candidate 기록을 감추고 Canonical mutation은 제공하지 않는다.
개인 저장과 분리해 회원 ID·ImportBatch·사용자 profile을 Provider 상세 Adapter에 전달하지 않는다. 새
Provider는 공통 materialization/detail interface를 바꾸지 않고 자신의 수집·상세 Adapter leaf만 추가한다.

Library, Visits, Writing은 서로 다른 owner다. Library는 visited 상태를 저장하지 않고,
Visits는 Rating이나 Writing을 저장하지 않으며, Writing은 Canonical Place ID만 연결한다.
각 transport는 platform 수준 product-authorization 결과에 의존한다. entrypoint는 제품
모듈이 Access source를 import하지 않도록 검증된 Access membership과 permission을 변환한다.

Profiles도 identity/publication과 abuse operations를 한 Store로 합치지 않는다. `PublicProfileStore`는
Handle·표시 이름·owner visibility와 익명 projection만 숨기고, `PublicProfileSafetyStore`는 report
receipt·보존·moderation 현재 상태·immutable decision·redacted queue를 숨긴다. HTTP는 두 깊은
Interface만 조립하고 moderation persistence를 직접 만지지 않는다. Library public Collection directory는
계속 주입 port이며 Profiles Adapter가 Library table을 join하지 않는다.

Appeal/Notice는 `PublicProfileSafetyStore` 메서드를 늘려 일반 report/moderation 호출자에게 노출하지
않고 `PublicProfileAppealStore`라는 별도 깊은 Interface에 둔다. PostgreSQL Appeal Adapter가 owner
Notice, 제출 제한, redacted queue, accepted/rejected resolution과 accepted moderation 복구 transaction을
숨긴다. 일반 Safety Adapter는 moderation decision과 그 owner Notice를 같은 transaction에서 만들고
pending Appeal이 있으면 Appeal Interface 사용을 요구한다. HTTP도 appeal route 구현 파일을 분리하되
Profiles의 외부 route 등록 Interface는 하나로 유지한다.

Stage 7.5 read surface도 이 경계를 유지한다. Visits와 Writing은 command Store의 raw/unbounded list를
확장하지 않고 각각 작은 query Interface와 자기 schema만 읽는 PostgreSQL Adapter를 둔다. Ingestion도
`ImportQueries`, `ImportManagementStore`, `ImportReviewStore`를 분리해 bounded read, cancel/resume,
명시적 review transaction을 서로 다른 Adapter가 소유한다. Visit history는 occurrence 내부
fingerprint/evidence를 공개하지 않으며, Writing list는 bounded preview와 detail을 분리하고 Import
cursor는 상태 filter 또는 batch ID에 묶인다. 인증·향후 tier 판단은 계속 transport 앞의 Product
Authorizer seam에 있고 query Adapter에는 검증된 member ID만 전달된다.

Library 조직 기능에서 Collection은 ordered membership, Tag는 member-scoped many-to-many label을
소유한다. `LibraryQueries`는 정렬된 Tag ID와 all/any mode를 받는 깊은 read Interface이고, HTTP는
이 계약을 해석만 한다. PostgreSQL의 일반 command write는 preference, ordered Collection, Tag leaf로
나뉘고 imported-place materialization과 query Adapter에서도 분리되어 rename/reorder/remove/delete가 Import나 표시용 Place hydration
책임을 끌어오지 않는다. 자동 분류는 미래 producer일 뿐 Tag truth나 command Interface의 owner가
아니다.

Preference write leaf는 작은 `set-place-preferences` Interface 뒤에서 목표 상태 갱신, command replay,
회원·Place별 직렬화, 예상 timestamp 비교, 단조 버전 갱신, Rating event를 한 transaction으로 처리한다.
Web과 HTTP는 이 동시성 구현을 알지 못하고 Place detail에서 받은 opaque timestamp만 되돌려준다.

Web의 Library management module은 View에 하나의 Interface를 제공한다. 구현 안에서는 Collection
조회·순서·삭제, Tag 수명주기, response-loss command 재시도를 별도 내부 seam으로 나눈다. 따라서
Collection 순서 규칙이나 재시도 정책을 View 파일과 Tag 흐름에 반복하지 않으면서도 선택한 Place의
기존 조직 편집 workflow와 관리 surface를 섞지 않는다.

Collection 공유도 같은 management Module의 작은 `publication` Interface 뒤에 둔다. Backend의
ordered Collection write Adapter가 owner lock, optimistic version, publication ID 수명주기와 copy
provenance를 한 transaction seam으로 숨긴다. HTTP는 `set-collection-publication`만 `library.share`로
권한 판정하고 role/tier 문자열을 Library로 넘기지 않는다. 공개 화면의 copy Adapter는 한 시도의
command/target ID를 보존해 View가 idempotency 구현을 알지 못하게 한다.

공개 Collection read는 command Store가 아니라 `LibraryQueries` Interface에 속한다. PostgreSQL
Implementation은 Library가 소유한 publication과 순서만 읽고, 기존 `LibraryPlaceSummaryReader`
Seam으로 모든 Place를 한 번에 보강한다. 이 Adapter가 Search table을 직접 join하지 않으므로 공개
Place projection의 교체와 Library transaction 규칙이 서로의 Module 내부로 새지 않는다.

Web의 `platform/visits`는 인증 session과 고정 Backend transport만 소비하는 same-origin Adapter다.
Personal Library의 visit workflow는 View에 기록·history·retry를 묶은 하나의 Interface만 제공하고,
불변 ID/payload 보존, selection staleness, bounded pagination을 내부에 숨긴다. Backend Visits owner가
replay/conflict와 occurrence truth를 계속 소유하며 Web은 Product Tier나 Provider evidence를 해석하지
않는다.

Web의 `platform/writing`도 인증 session과 고정 Backend transport만 소비한다. browser command
Interface는 private Note 생성·수정만 허용하고 Adapter가 Backend command의 visibility를 고정한다.
Personal Library note workflow는 목록·상세·draft·replay·version conflict를 하나의 Interface 뒤에
숨긴다. Writing owner의 revision/publication 규칙이나 future Entry editor를 View로 끌어오지 않는다.

회원 전체 Library를 한 번에 반환하는 unbounded Store 메서드는 두지 않는다. HTTP composition은
bounded `LibraryQueries`를 필수로 주입하고 테스트도 같은 public Interface를 사용한다.

지역·Taxonomy facet도 `LibraryQueries`의 깊은 Interface 뒤에 둔다. Library Adapter는 current-member
saved Place ID만 bounded하게 읽고 composition이 주입한 public Place summary reader로 집계·필터한다.
Search table을 직접 join하거나 전역 Taxonomy node를 회원 선택지로 제공하지 않으며, 불완전한
projection과 표본 한계는 versioned coverage로 드러낸다.

필수 회원 route와 optional-member Place/Search route는 platform HTTP의 공통 authorization
Interface를 사용한다. 이 Interface는 `anonymous`, authorized `member`, 이미 안전한 응답을 보낸
`replied` 상태만 transport에 돌려주며, feature module에는 token·role·tier 문자열을 전달하지 않는다.
Product Authorizer 장애도 한 versioned Problem으로 fail closed한다. 실제 Backend transport와 Next
route 파일에서 수집한 method/path 집합은 생성 OpenAPI와 architecture test에서 양방향 비교하므로,
문서에만 남은 route나 문서 없는 route를 허용하지 않는다.

Taxonomy는 Node version을, Search는 Local Search Projection과 source 조정을 각각 소유한다.
Search adapter는 Places/Taxonomy/Library/Visits schema를 직접 조회하지 않는다. 각 owner가
공개 projection command 또는 미래 event adapter를 통해 최소 검색 사실과 source version을
전달한다. 이 중복 read model은 검색을 위한 것이며 canonical truth가 아니다.
