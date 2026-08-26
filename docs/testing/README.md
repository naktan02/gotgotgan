# Testing documentation

- `architecture.md`: dependency and forbidden-bucket checks.
- `contracts.md`: schema and compatibility checks.
- `integration.md`: real PostgreSQL/PostGIS and process tests.
- `e2e-playwright.md`: browser-owned critical journeys and screenshots.

Blocking tests are deterministic. The PostGIS suite covers empty-catalog discovery, repeat-local-hit,
selection and canonical-materialization replay, connected Import review, and encrypted capture expiry
cleanup. Playwright covers rapid typing cancellation, ambiguous branches, keyboard/mobile selection,
provider partial failure, full-search fallback, and Import cancel/resume/review retry. Live map/provider
checks require explicit opt-in and never supply shared personal credentials.

Materialization PostGIS는 동일 Provider Place ID의 여러 회원 intent가 job 하나를 공유하고, 외부 상세
호출 없이 snapshot으로 Canonical Place와 각 회원 Collection에 저장되는지 검증한다. 상세 상태는
정규화 관찰이 생길 때까지 `pending`이며 저장을 롤백하지 않는다. Import Playwright는 `enriching`
상태에서 검토 control이 노출되지 않다가 `needs-review` 전환 후에만 활성화되는 desktop/mobile 흐름과
명시적 Source List/Item/Provider Place ID 및 지도 열기 링크를 검증한다.

현재 진단용 로컬 커넥터 unit test는 로그인 중 response capture 미등록, exact-origin body opt-in,
provider 하위 origin의 metadata-only discovery, body 크기 제한, query·동적 경로·민감 키·값 제거,
private report 생성 전용 쓰기, 취소 시 context 종료를 검증한다. 별도 아키텍처 테스트는 application의
Playwright/filesystem 역참조와 다른 Place workspace package import를 거부한다. 실제 계정 관찰은
blocking CI가 아닌 명시적 사용자 실행이며 비식별 보고서만 남긴다.

수집기 fixture test는 현재 `folders/shareId`, `bookmarks/count`와 legacy
`folderList/shareID`, `bookmarkList/totalCount`를 같은 NAVER leaf에서 해석하고 모든 folder·bookmark
페이지를 순회하는지 검증한다. 별칭·memo·원문 URL·분류 코드/경로·시각·available 상태를 누락하지
않고, 다른 origin·oversize·login redirect·schema drift·전체 상한에서는 값을 출력하지 않고 닫히는지도
검증한다. live 합계 검증은 first-party 로그인 boolean과 Provider API 성공이 모두 확인될 때만 통과다.

현재 확장 foundation의 blocking unit/contract gate는 versioned handshake/message/upload 계약,
operation-bound grant와 exact-origin 일치, fake port의 전체 pagination, bounded batch, checksum/receipt,
progress/cancel, browser 감지와 installation reference를 결정적으로 검증한다. Chromium과 Firefox
Manifest V3를 따로 build해 기본 권한·Place origin·Firefox declaration을 검사한다. Chrome·Edge·Whale은
같은 Chromium 산출물을 쓰지만 Whale 실설치 증거는 아직 없다.

다음 Extension E2E는 test-owned Place page와 Provider origin을 사용해 background/content bridge부터
공개 BFF receipt까지 실행하고 동일 replay, 부분 실패, 여러 설치, 연결 해제와 모든 resource close를
검증한다. Safari는 packaging/signing/install/live test 전에는 지원으로 표시하지 않는다. 실제 NAVER
smoke는 opt-in이고 계정 material, cookie, response value, profile 경로를
trace·screenshot·report·CI artifact에 남기지 않는다.
