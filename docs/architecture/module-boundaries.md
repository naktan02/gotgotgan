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

NAVER folder/bookmark schema와 전체 pagination은 `adapters/providers/naver`의 깊은 leaf가 소유하며
확장과 진단 CLI가 같은 collector를 조립한다. `acquisition/adapters/playwright`는 first-party fetch와
전용 context 수명주기를 소유하는 진단 Adapter다. 전용 profile은 평소 로그인 session을 재사용하지
못하므로 주 회원 경계가 아니라 Playwright 진단·fixture/replay·E2E·통제된 fallback으로 남긴다.
확장 제출은 이 Adapter나 Backend source를 직접 import하지 않고 versioned connector 계약으로 연결한다.

Backend의 Connector 수신도 Ingestion 안에서 깊은 interface 하나로 닫는다. HTTP와 production
composition은 `issueGrant`와 `submitCapture`만 호출하고, Postgres operation/receipt, 암호화 artifact,
Provider-neutral parser port는 내부 조립 세부사항이다. production composition만 Providers 공개
`parseNaverSavedPlaceCapture`를 parser port로 바꾸며 Ingestion은 Providers 내부 경로를 역참조하지 않는다.

NAVER·Kakao·Google은 같은 확장의 Provider Adapter이며 Provider별 확장을 만들지 않는다. Chromium,
Firefox, Safari 차이는 Provider leaf로 역류하지 않는다. Stage 10 외부 저장은 Import용 Source를
비대하게 만들지 않고 별도 `SavedPlaceTarget` Interface를 사용한다. ADR 0012가 이 경계를 고정한다.

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
