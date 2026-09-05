# Runtime and deployment

The HTTP server is an always-available interactive runtime. The acquisition worker is a separate
process from the same backend build and may be continuous, scheduled, or on demand. Process scaling
does not change module ownership.

Stage 7 Worker의 durable queue, lease/fencing, NAVER 승인 캡처 parser와 암호화 replay adapter는
`source-only`다. `--check`는 이 capability와 live acquisition의 `integration-gated` 상태를 구분해
출력한다. `--sweep-expired-captures`는 별도 1회 유지보수 명령으로, 보호된 DB URL·AES keyring,
private capture volume과 bounded batch를 조립하고 종료 시 Pool을 닫는다. production Compose는
이 명령만 opt-in `maintenance` profile로 선언한다. 실제 profile lifecycle과 Playwright acquisition
설정이 없으므로 연결 계정 수집 Worker의 일반 startup은 계속 fail-closed다.

Provider Identity별 Materialization Worker는 PostgreSQL queue를 계속 claim하며 가져온 Source Snapshot을
Canonical Place와 회원 Library에 반영한다. 이 Worker는 외부 Provider나 사용자 profile을 호출하지
않으므로 Web·Backend와 독립된 내부 Compose process로 활성화한다. Provider 상세 상태와 후속 상세 Job은
이 수명주기와 분리되어 있으며 실제 NAVER 상세 경로 관찰 전에는 활성화하지 않는다. 회원 PC Connector의
NAVER 목록 수집 Adapter는 별도 browser artifact에 있으며 Worker나 Docker에 포함되지 않는다.

회원 PC용 `member-connector`는 배포 Web/Backend/Worker나 Docker 수평 확장 단위가 아니다. 특정 확장
프로그램을 필수 runtime으로 정하지 않고 실행 호스트 Adapter가 profile·창·network·memory 수명주기를
소유한다. 완료·취소·실패 때 listener, 창, 요청과 메모리를 닫는다. 현재 WebExtension은 선택형
source-only Adapter이며 2026-09-05 승인된 desktop shell은 NAVER 로그인·최소 목록 수집부터 구현한다.
개발 중인 browser-control 프로젝트는 도입하지 않는다. 회원 기기
산출물은 production Docker image나 Compose service가 아니다.

서버 Docker build의 `npm ci`는 Web·Admin·Backend와 공유 계약/auth workspace만 선택한다.
회원 기기 전용 Electron 의존성과 binary를 서버 build에 설치하지 않는다.
이미 선언된 파일 의존성이 설치 시 존재하도록 build와 production dependency stage 모두 저장소의
`vendor/` package artifact를 복사한다. 이 조치는 TraceForge 코드를 바꾸거나 상세 Worker를 활성화하지 않는다.

현재 WXT 기반 source는 Chromium Manifest V3와 Firefox Manifest V3 산출물을 결정적으로 만든다.
Chromium 산출물은 Chrome·Edge·Whale이 공유하며 browser Adapter가 Whale을 Chrome보다 먼저 식별한다.
이 build 결과는 Docker image에 포함하지 않는다. NAVER Adapter와 exact optional permission은
source-only로 연결됐지만 실제 브라우저 설치·업데이트·서명·배포 수명주기는 아직 없다. Whale은
실설치와 로그인된 session smoke 전까지 `integration-gated`다. 확장 background는 사용자가 NAVER
가져오기를 시작한 동안에만 first-party request와 bounded 수집 메모리를 소유한다.

현재 visible Chrome context를 생성하는 login, redacted observation, bounded local collection은 확장
이전의 source-only 진단 CLI다. 전체 저장목록 결과는 메모리에서 폐기되고 합계만 출력한다. 전용
profile의 로그인 성공은 제품 완료 조건이 아니며 Playwright 진단·fixture/replay·E2E·통제된 fallback으로
유지한다. Extension capture Adapter, Web의 grant/capture BFF route와 Backend
`/v1/connector-grants`·`/v1/connector-captures` 수신 endpoint는 source-only로 연결됐다. Backend HTTP
프로세스가 짧은 수명 grant와 캡처 수신을 소유하고 암호화 capture volume을 maintenance sweep과
공유한다. 이 경로는 별도 acquisition Worker를 깨우지 않고 ImportBatch·ImportItem·Materialization intent를
직접 영속화한다. 활성 Materialization Worker가 이를 private Collection에 반영한다. 실제 Whale/NAVER
session smoke와 Provider 상세 Job은 integration-gated다.

The source-only runtime exposes local health/readiness scaffolds and the Stage 2 shell/access code.
Gateway, Identity, provider, map, family navigation, and AI delivery states remain `not-integrated`
or `integration-gated` as routed in the workspace plan. The Place-owned physical PostGIS runtime is
declared source-only and is not yet connected to a deployed Web, backend, or worker environment. A
source-only backend production composition now creates one bounded Pool, installs the access
PostgreSQL adapter and OIDC verifier, registers all access transports, and owns readiness/close. It
is selected only by explicit process mode with complete protected configuration. A source-only Node
instrumentation hook can explicitly enable the Web OIDC composition, readiness-check
its bounded database pool before server readiness, schedule bounded cleanup, and close it on process
signals. Reviewed browser auth routes consume that runtime. Membership BFF routes use an independently
activated stateless backend client plus the auth session interface and fail closed if either required
runtime is absent. No active external route or provisioned Identity flow is implied.

Backend production composition also adds an official provider source only when that provider's
complete HTTPS endpoint/secret-file/timeout group is present. The local search source remains
independent, so a provider timeout or throttle cannot make personal search unavailable. Provider
credentials never enter Web configuration or payloads. Omitted groups are disabled; partial groups
fail startup. The acquisition Worker remains `not-integrated` and no browser profile lifecycle is
created by this HTTP-only stage. Web Import BFF readiness is independently activated and checks the
fixed internal Backend origin without exposing it to the browser.

`deploy/application-runtime.json` fixes member Web as the only public Gateway-facing process and
Admin Web as a separate restricted Gateway candidate. Backend and Worker remain internal; browsers
cannot select or call Backend directly. Admin Web is not a conditional view inside member Web: it is
an opt-in sibling container in the same `place` Compose project and default network. The Compose base
publishes no host ports, `compose.local.yml` adds explicit standalone ports, and the production
overlays mount symbolic secret/config roles and the Place data network without embedding an address
or credential.

One digest-pinned multi-stage Dockerfile produces separate `web-runtime`, `admin-web-runtime`, and
`backend-runtime` targets. The worker uses the backend image with a different command. Local Compose
alone owns those build targets. The port-free base and production overlays consume injected
immutable image coordinates, while the deployment planner binds Web, Admin Web, and Backend to one
source revision and rolls back all three together while preserving the database. Compose requires
every host and port from deployment configuration. Worker `--check` stays in the verification
profile. Legacy source-snapshot place fulfillment and approved v2 transfer materialization run as
separate containers from the same backend image, so their queues, restart and scaling remain
isolated. Legacy encrypted capture-file cleanup is an operator-invoked maintenance profile; the v2
transfer worker separately expires database-backed connector grants/captures and outbound receipts
before claiming approved materialization. Neither path activates live acquisition.
The producer release declaration binds those three targets and six process roles to one
`place@<commit>` revision while retaining `source-only` deployment state. The manual release
workflow owns GHCR publication, BuildKit SBOM/provenance extraction, published-platform-digest
smoke, and the checksum-bound release record. It has no promotion or environment authority.
Existing commit tags are immutable checkpoints: a retry verifies any existing image before building
only the missing image, then regenerates evidence for the complete release unit.

Admin authentication does not reuse member Web state. `PLACE_ADMIN_*` OIDC configuration, the Admin
client secret, Admin encryption keyring, callback, cookies, and session namespace are independent;
only the credential-free internal Backend origin is shared. `compose.admin.production.yml` enables
that runtime only with a complete protected configuration and uses `/readyz` for activation. A
source-only Admin image smoke deliberately disables OIDC, so it proves `/healthz=200` and the
fail-closed `/readyz=503` state rather than claiming production readiness.
The separate `compose.database.yml` remains in the same `place` Compose project, publishes no host
port, and requires an injected private data network, volume, administrator identity, and secret file.
