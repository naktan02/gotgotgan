# HTTP 런타임

Backend 시작에는 배포가 주입하는 `PLACE_HTTP_HOST`, `PLACE_HTTP_PORT`와 명시적인
`PLACE_HTTP_RUNTIME_MODE`가 필요하다. `source-only`는 수명주기 경로만 노출한다. `production`은
보호된 런타임 데이터베이스 URL, 제한된 Pool 설정, OIDC 리소스 서버 설정과 보호된 멤버십 정책
파일도 요구한다. 시작 전에 PostgreSQL을 검증하고, 검토된 접근 전송 계층을 등록하며, Pool 장애를
`/readyz`로 보고하고 Pool보다 먼저 Fastify를 종료한다.

Backend 운영 설정은 다음과 같다.

- `PLACE_DATABASE_URL_FILE` containing one complete PostgreSQL URL;
- `PLACE_DATABASE_MAX_CONNECTIONS` from 1 through 100;
- `PLACE_DATABASE_IDLE_TIMEOUT_MILLISECONDS` from 1 through 600,000;
- `PLACE_DATABASE_CONNECTION_TIMEOUT_MILLISECONDS` from 1 through 60,000;
- `PLACE_MEMBERSHIP_POLICY_FILE` containing one strict `place-membership-policy.v1` JSON document;
- `PLACE_AUTH_MODE=oidc`
- `PLACE_OIDC_ISSUER`, `PLACE_OIDC_AUDIENCE`, `PLACE_OIDC_JWKS_URI`

멤버십 정책은 `requiredConsents`, `initialUserGrade`, `initialProductTier`를 포함한다. 공개 스키마는
`packages/contracts/membership/membership-policy.v1.schema.json`이다. 문서, 버전, 등급, 티어에 대한
저장소 기본값은 없다. 운영 로더는 테스트 인증을 계속 거부한다. 로그인 요청 범위는 별도의
`PLACE_OIDC_SCOPES`로 지정하며, 액세스 토큰 검증은 서명·발급자·대상·시간·주체 클레임을 확인한다.

`loadOidcProcessRuntimeConfig` requires these secret-file references:

- `PLACE_DATABASE_URL_FILE` for the complete runtime PostgreSQL URL;
- `PLACE_OIDC_CLIENT_SECRET_FILE` for the confidential OIDC client secret; and
- `PLACE_OIDC_ENCRYPTION_KEYRING_FILE` for a one-line JSON keyring.

The keyring shape is
`{"activeKeyId":"<key-id>","keys":[{"id":"<key-id>","value":"<32-byte-base64url>"}]}`.
Rotation keeps the active key plus any retained decryption keys in this protected file. The loader
also requires these non-secret settings:

- `PLACE_OIDC_RUNTIME_ENABLED`, exactly `true` to install or `false`/unset to remain inactive;
- `PLACE_OIDC_ISSUER`, `PLACE_OIDC_CLIENT_ID`, and `PLACE_OIDC_CALLBACK_URL`;
- `PLACE_OIDC_POST_LOGIN_PATH` and space-delimited `PLACE_OIDC_SCOPES`;
- `PLACE_OIDC_TRANSACTION_TTL_SECONDS` and `PLACE_OIDC_SESSION_TTL_SECONDS`;
- `PLACE_OIDC_DATABASE_MAX_CONNECTIONS`;
- `PLACE_OIDC_DATABASE_IDLE_TIMEOUT_MILLISECONDS`;
- `PLACE_OIDC_DATABASE_CONNECTION_TIMEOUT_MILLISECONDS`;
- `PLACE_OIDC_STARTUP_RETRY_ATTEMPTS` and
  `PLACE_OIDC_STARTUP_RETRY_DELAY_MILLISECONDS`, whose product is capped at five minutes;
- `PLACE_OIDC_CLEANUP_BATCH_SIZE`; and
- `PLACE_OIDC_CLEANUP_INTERVAL_SECONDS`;
- `PLACE_MEMBERSHIP_RUNTIME_ENABLED`, exactly `true` to install the backend bridge or `false`/unset
  to keep it inactive;
- `PLACE_BACKEND_ORIGIN`, the credential-free origin used only by the Web server; and
- `PLACE_MEMBERSHIP_BACKEND_TIMEOUT_MILLISECONDS`, from 1 through 60,000.

Cleanup is rejected above 1,000 rows per table per call. The actual Next process calls this
loader only through its Node instrumentation lifecycle, which installs once before readiness,
retries transient database startup failures within the bounded deployment policy,
registers signal close, schedules non-overlapping retryable cleanup, and shares the runtime with
reviewed auth route bundles through a process-global symbol. A separate membership lifecycle owns
only the stateless backend client and has an independent fail-closed activation switch. It uses fixed
readiness, current-consent, and onboarding paths, rejects redirects, and never publishes its origin
or bearer to the browser. Web `/readyz` checks both activated runtimes and maps timeout, non-2xx, or
database failure to a sanitized 503. Mounted deployment secrets, Identity
provisioning, and Gateway validation remain required before callback activation. An operator must
not substitute direct secret values or process memory for login transactions or sessions.

## Admin Web 런타임

Admin Web은 member Web의 route나 표시 모드가 아니라 별도 Next process다. Listener는
`PLACE_ADMIN_WEB_HOST`와 `PLACE_ADMIN_WEB_PORT`로 주입하고, 인증 수명주기는 동일한 검증 로직을
사용하되 독립된 `PLACE_ADMIN` prefix와 cookie/storage namespace를 사용한다. 운영 활성화에는 다음
보호 파일이 모두 필요하다.

- `PLACE_ADMIN_DATABASE_URL_FILE`;
- `PLACE_ADMIN_OIDC_CLIENT_SECRET_FILE`; and
- `PLACE_ADMIN_OIDC_ENCRYPTION_KEYRING_FILE`.

issuer, client ID, callback, post-login path, scopes, transaction/session TTL, bounded DB pool,
startup retry, cleanup 설정도 모두 `PLACE_ADMIN_OIDC_*` 이름으로 별도 주입한다. Backend 호출에는
credential-free `PLACE_BACKEND_ORIGIN`과 `PLACE_ADMIN_BACKEND_TIMEOUT_MILLISECONDS`만 사용하며,
브라우저에 Backend 주소나 bearer를 공개하지 않는다.

`PLACE_ADMIN_OIDC_RUNTIME_ENABLED=true`와 완전한 secret/configuration group이 있을 때만 Admin
`/readyz`가 인증 저장소와 Backend readiness를 함께 검증한다. 기본 source-only 모드는
`/healthz=200`, `/readyz=503`으로 실패 폐쇄한다. production Compose healthcheck는 `/readyz`를
사용하므로 부분 구성이나 member Web client/secret의 재사용으로 활성화할 수 없다.
