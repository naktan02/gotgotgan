# Provider runbook

Before live provider work, define credential/profile ownership, sanitized fixtures, concurrency and
rate limits, user-action states, retention, parser rollback, and provider-specific disable switches.
An operator can stop one capability/provider without disabling the personal library.

Stage 6 official search activation uses all-or-none groups. Every URL must be deployment-owned HTTPS
without URL credentials, query, or fragment; every secret is a one-line protected file.

```text
NAVER: PLACE_NAVER_SEARCH_ENDPOINT
       PLACE_NAVER_CLIENT_ID_FILE
       PLACE_NAVER_CLIENT_SECRET_FILE
       PLACE_NAVER_TIMEOUT_MILLISECONDS

Kakao: PLACE_KAKAO_SEARCH_ENDPOINT
       PLACE_KAKAO_REST_API_KEY_FILE
       PLACE_KAKAO_TIMEOUT_MILLISECONDS

Google: PLACE_GOOGLE_PLACES_BASE_URL
        PLACE_GOOGLE_PLACES_API_KEY_FILE
        PLACE_GOOGLE_TIMEOUT_MILLISECONDS
```

Omitting a whole group disables that source; a partial group fails startup. One provider failure is
reported as an unavailable source and does not fail local or other-provider results. Google photo
resource names are not persisted or cached. Default blocking tests replay redacted fixtures. An
operator may run the non-blocking live classification with `PLACE_PROVIDER_LIVE_SMOKE=1`,
`PLACE_PROVIDER_LIVE_QUERY`, and one or more complete groups via `npm run test:provider-live
--workspace @place/backend`.

Stage 6.5에서 같은 credential group은 제출 검색과 자동완성 adapter를 함께 조립한다. Google
Autocomplete session token은 server-side에서만 생성되고 public session UUID와 구분된다. NAVER와
Kakao는 현재 공식 search fallback이므로 별도 autocomplete 기능을 지원한다고 표시하지 않는다.
운영 시 source별 latency/error/zero-result/selection/repeat-local-hit를 관찰하고 한 provider를 꺼도
local Discovery와 다른 source가 계속 동작해야 한다. session, impression, Discovery TTL 정리는
bounded batch로 실행하며 Canonical/Ingestion evidence를 삭제하지 않는다.

입력마다 Playwright browser를 시작하지 않는다. NAVER first-party UI가 공식 fallback보다 실제로
유의미하게 낫다는 측정이 있을 때만 별도 discovery spike에서 network contract, session/header,
drift, latency를 분류한다. 안정된 direct HTTP adapter와 공식/local fallback이 없으면 hot path로
활성화하지 않는다.

연결 목록 Import에서 회원 session은 하나의 Place Connector 확장이 사용하며 Provider별 exact-origin
permission, session probe, 일회성 grant, batch 상한, progress/cancel, tab/listener/resource close를
점검한다. Provider cookie·token·profile 경로는 Place로 보내지 않는다. Provider별 확장을 만들지 않고
NAVER·Kakao·Google Adapter의 delivery state를 따로 기록한다. 가져온 snapshot의 private Collection
저장은 Provider profile 없이 실행한다. 후속 상세 보강에 서버 profile이 필요하면 별도 read-only
workload로 운영하고 회원 ID나 목록 이름을 전달하지 않는다. 실제 NAVER 상세 Adapter가 추가되기
전까지 상세 Job은 integration-gated다.

실제 Whale/NAVER 확장 경로를 검증하기 전의 진단·재현용 회원 로컬 NAVER 관찰은
[`../../apps/member-connector/README.md`](../../apps/member-connector/README.md)의
두 단계 명령을 따른다. login에서는 캡처가 꺼져 있고, observation은 먼저 화면 origin만 body opt-in해
provider 하위 origin 후보를 값 없이 찾는다. 후보를 검토한 뒤 필요한 exact origin만 추가한다. profile과
report는 저장소·DB·Docker volume 밖의 서로 겹치지 않는 private 경로를 사용한다. 보고서 ID와 응답 수
외에는 CLI 결과에 경로 또는 Provider data를 출력하지 않는다. 현재 보고서를 서버에 제출하거나 live
Worker를 깨우는 명령은 없으며, 이를 수동 복사로 우회하지 않는다.

진단용 전체 로컬 수집은 같은 문서의 `member-connector:collect:naver` 명령을 사용한다. first-party session
page와 API base는 관찰 결과를 deployment 환경으로 주입하고, folder/bookmark page size·응답 크기·
전체 목록/장소 상한·timeout·요청 간격을 모두 명시한다. 실행 전 first-party profile API가 로그인
상태로 인식하는지 확인한다. 301/302/401/403/405는 장소 schema로 parse하지 않고 재로그인 또는
Provider drift가 필요한 user-action 상태로 분류한다. 성공해도 현재는 합계만 출력하고 수집 값은
폐기하므로 ImportBatch가 생성됐다고 해석하지 않는다.

전용 Playwright profile의 로그인 성공은 더 이상 제품 활성화 gate가 아니다. 확장 활성화는 별도
Connector 계약/위협 모델, fake Provider E2E, Chrome/Edge·Firefox build, NAVER existing-session opt-in
smoke, 비식별 replay fixture, 공개 BFF upload receipt가 모두 통과해야 한다. Safari는 macOS
packaging/signing/install/live evidence 전까지 `integration-gated`다. 확장 미지원·미설치 경로는 수동
JSON/file capture를 사용하며 사용자별 localhost 서버나 native host로 우회하지 않는다.

현재 Connector 계약, NAVER Provider Adapter, exact optional permission, fake port 단위 검증,
Chromium·Firefox Manifest V3 build와 manifest 검사는 source-only로 통과한다. Chromium 산출물 하나를
Chrome·Edge·Whale에 사용한다. Whale은 실설치 smoke가 없으므로 build 호환과 실제 지원을 구분한다.
Firefox는 별도 산출물과 website content data declaration을 검사한다. Web의 공개 BFF route는 있지만
Backend grant/capture receiver와 PostGIS ImportBatch 영속화도 source-only로 연결됐다. 운영 활성화 전에는
공개 origin, grant TTL과 상한, capture keyring·private volume, Web/Backend timeout을 모두 주입하고
Whale에서 기존 NAVER session을 쓰는 실제 한 번의 전체 목록 smoke를 수행한다.
