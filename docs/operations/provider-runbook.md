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
