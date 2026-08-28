# Playwright E2E

The repository pins `@playwright/test` and its browser set. `PLACE_WEB_E2E_BASE_URL` supplies the
test-owned address. Desktop and mobile projects both explicitly use Chromium, validate the responsive
shell, and own reviewed Windows and Linux screenshot baselines. CI retains Playwright reports,
actual images, diffs, and traces on failure. Each user-visible milestone adds success, denial, loading, empty, error, and recovery paths
that it actually introduces.

Stage 7 브라우저 UI E2E는 test-owned BFF fixture로 connection 목록, import 시작, partial progress,
cancel/resume, duplicate/incomplete review를 desktop/mobile에서 검증한다. 첫 review 응답을 의도적으로
실패시킨 뒤 같은 command ID로 재시도하며, request에 token/profile/cookie/secret이 없음을 확인한다.
이는 live Provider 수집 증거가 아니다. 별도 opt-in Playwright acquisition smoke는 일반 E2E와
분리하고 전용 test account/profile만 사용하며 아직 integration-gated다.

Member Connector의 Chromium·Firefox Manifest V3 build 검사는 Playwright E2E가 아니다. imports
Playwright는 가짜 확장을 page에 설치해 probe → permission 준비 → grant → progress → `importBatchId`
완료 전환을 desktop/mobile에서 검증한다. 실제 산출물을 test-owned Place/Provider origin에 설치해
background → NAVER session → capture → 공개 BFF receipt를 검증하는 live E2E는 별도 gate다.
Chrome·Edge·Whale이 공유하는 Chromium 산출물도 각 브라우저 실설치 smoke를 따로 기록하며, 특히
Whale은 이 evidence 전까지 `integration-gated`다.

같은 Import E2E는 `enriching` batch/item을 desktop·mobile에서 저장 준비 상태로 표시하고,
create/link/skip 검토 control이 노출되지 않는지도 검증한다. 저장된 item은 Source List·Item·Provider
Place ID, `상세 대기`, NAVER·Google Maps·카카오맵 열기 링크를 표시한다. fixture가 이후
`needs-review`로 전환되면 기존 동일 command 재시도와 검토 흐름을 계속 실행한다.

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

Personal Library Playwright는 저장·가고 싶음·Personal Rating의 목표 상태 command가 직전
`preferencesUpdatedAt`을 연쇄적으로 사용하고, 저장 해제 후 saved 목록이 갱신되는 흐름을 desktop과
mobile에서 검증한다. stale 409에서는 사용자의 의도를 자동 재적용하지 않고 최신 상태를 다시 읽는
것과 적용 후 응답 유실에서는 같은 command ID로 재시도하는 것도 확인한다. 이 fixture는 member ID,
bearer token, Provider payload를 browser command에 포함하지 않는다.

Library 관리 E2E는 private Collection 생성·삭제, Collection/Tag 이름 변경, Tag 생성·삭제,
Collection Place 이웃 순서 이동·제거, 관리 후 탐색 화면의 최신 목록, 응답 유실 후 동일 management
command ID/payload 재전송을 desktop/mobile에서 검증한다. 화면은 Provider 원본 목록을 바꾸지 않는다는
문구를 함께 노출한다.

Visit E2E는 같은 Place의 반복 방문이 서로 다른 불변 occurrence로 쌓이고 bounded history와 Place
summary가 갱신되는지 desktop/mobile에서 검증한다. 첫 기록 응답을 유실시킨 경우에는 새 ID를 만들지
않고 동일 Visit ID와 payload를 재전송한다. focused Personal Library suite는 두 browser project에서
20개 case를 실행하며 browser request에 evidence나 member ID를 넣지 않는다.

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

Stage 6.5는 제출 검색과 분리된 입력 중 suggestion fixture를 추가한다. desktop/mobile Chromium은
빠른 입력의 stale request 취소, 같은 이름의 후쿠오카/도쿄 지점 구분, 키보드 이동·선택,
영문 표기 변형, 일부 provider 장애, 후보 없음 후 전체 검색 fallback, 반복 선택 기록을 실제 Web
BFF 경계로 검증한다. browser payload에는 provider token/API key/cookie/profile이나 membership별
검색 signal이 없어야 한다. fixture는 live provider나 실제 사용자 계정을 대신하지 않는다.
