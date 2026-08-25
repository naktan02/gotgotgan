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
