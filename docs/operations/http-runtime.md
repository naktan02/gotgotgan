# HTTP runtime

Production startup requires deployment-injected `PLACE_HTTP_HOST` and `PLACE_HTTP_PORT`; the source
contains no address default. The process owns listen, readiness, signal handling, drain, and close.
Health and readiness are the only active deployment flow. Source-only `GET /v1/me` registration and
membership onboarding remain conditionally unregistered, and the browser-auth routes are not an
active Identity flow without their required dependencies. The
source-only browser-auth process factory owns bounded pool creation, readiness, expired-record
cleanup, and close against encrypted PostgreSQL storage.

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
- `PLACE_OIDC_CLEANUP_BATCH_SIZE`; and
- `PLACE_OIDC_CLEANUP_INTERVAL_SECONDS`;
- `PLACE_MEMBERSHIP_RUNTIME_ENABLED`, exactly `true` to install the backend bridge or `false`/unset
  to keep it inactive;
- `PLACE_BACKEND_ORIGIN`, the credential-free origin used only by the Web server; and
- `PLACE_MEMBERSHIP_BACKEND_TIMEOUT_MILLISECONDS`, from 1 through 60,000.

Cleanup is rejected above 1,000 rows per table per call. The actual Next process must call this
loader only through its Node instrumentation lifecycle, which installs once before readiness,
registers signal close, schedules non-overlapping retryable cleanup, and shares the runtime with
reviewed auth route bundles through a process-global symbol. A separate membership lifecycle owns
only the stateless backend client and has an independent fail-closed activation switch. It uses fixed
current-consent and onboarding paths, rejects redirects, and never publishes its origin or bearer to
the browser. Mounted deployment secrets, Identity
provisioning, and Gateway validation remain required before callback activation. An operator must
not substitute direct secret values or process memory for login transactions or sessions.
