# Playwright E2E

The repository pins `@playwright/test` and its browser set. `PLACE_WEB_E2E_BASE_URL` supplies the
test-owned address. Desktop and mobile projects both explicitly use Chromium, validate the responsive
shell, and own reviewed Windows and Linux screenshot baselines. CI retains Playwright reports,
actual images, diffs, and traces on failure. Each user-visible milestone adds success, denial, loading, empty, error, and recovery paths
that it actually introduces.

The E2E launcher injects the contract-owned active family-navigation test fixture when the caller has
not supplied one. The fixture uses reserved example destinations and is test evidence only; it does
not declare a real family service or active integration.

Source-only OIDC denial E2E verifies that start, callback, and logout fail closed while the runtime
is inactive, that problems are safe and correlated, and that logout rejects GET. This does not claim
an active Identity or Gateway flow. When activated, Playwright must additionally cover the
public-path success flow, refresh/expiry, missing or
replayed transaction, unmapped membership, suspended membership, and sanitized provider failure
through the public Gateway path; browser assertions must prove that no token or internal endpoint is
observable.

Source-only membership denial E2E likewise verifies that current-consent and onboarding browser
routes return hardened correlated 503 problems while the server runtime is inactive and that their
opposite HTTP methods are not exposed. Unit boundary tests separately prove that onboarding takes
the access token from the server session, uses a fixed backend endpoint, and excludes it from the
browser response.

The same test verifies `/readyz` remains healthy when those optional integrations are explicitly
disabled. Production readiness denial and recovery are covered at the Web process interface; a full
public-path success E2E remains gated on provisioned Identity and Gateway.

Backend HTTP interface tests cover current-consent projection, onboarding creation, idempotent
existing-member resolution, missing bearer evidence, unsupported browser authority fields, malformed
JSON, stale consent, and sanitized persistence failure. They also cover the authority-management
success boundary and unauthorized target non-disclosure. Browser Playwright onboarding success
remains integration-gated until a test composition can exercise a complete provisioned Identity
session through Gateway.

Stage 4 Playwright는 Web process 옆에 test-owned 공개 Backend를 실행한다. desktop과 mobile
Chromium은 실제 Web server 경계를 통해 unlisted Collection과 public Entry를 표시한다. 공개되지
않은 identifier는 membership이나 Rating data 없이 동일한 안전한 404를 반환하는지 확인한다.
fixture는 계약을 따르는 개인 데이터만 포함하며 provider 또는 authentication 우회가 아니다.

Stage 5 Playwright는 같은 공개 경계에 결정적인 Taxonomy/Search fixture를 연결한다. 입력
debounce와 교체 요청의 실제 upstream 취소, 목록·마커 선택 동기화, 명시적 bounds 재검색,
Taxonomy filter, cursor pagination, mobile 목록/지도 전환, partial·loading·empty·error·retry와
개인 field 비노출을 직접 검증한다. 기본 화면은 1440x900, 1280x800, 390x844, 360x800을
소유하고 partial/loading/error/empty/mobile-map 상태도 별도 screenshot으로 검토한다. 이 fixture와
결정적 좌표 renderer는 live 지도/provider 연동 증거가 아니다.

Stage 6는 같은 test-owned Backend에 provider-labeled Google 결과와 지연 상세 fixture를 추가한다.
Playwright는 외부 결과가 canonical Place ID로 가장되지 않는 계약, source label과 원문 열기,
선택 후에만 발생하는 detail 요청, provider rating과 사진 작성자 attribution, browser payload의
credential 비노출을 검증한다. NAVER/Kakao raw response parser는 module fixture replay가 맡는다.
실제 provider 호출은 blocking E2E와 screenshot baseline에서 금지하고 opt-in live smoke로만
분류한다.
