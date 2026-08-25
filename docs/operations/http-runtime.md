# HTTP runtime

Backend startup requires deployment-injected `PLACE_HTTP_HOST`, `PLACE_HTTP_PORT`, and an explicit
`PLACE_HTTP_RUNTIME_MODE`. `source-only` exposes lifecycle routes only. `production` additionally
requires a protected runtime database URL, bounded Pool settings, OIDC resource-server settings, and
a protected membership-policy file. It verifies PostgreSQL before startup, registers every reviewed
access transport, reports Pool failure through `/readyz`, and closes Fastify before its Pool.

The backend production settings are:

- `PLACE_DATABASE_URL_FILE` containing one complete PostgreSQL URL;
- `PLACE_DATABASE_MAX_CONNECTIONS` from 1 through 100;
- `PLACE_DATABASE_IDLE_TIMEOUT_MILLISECONDS` from 1 through 600,000;
- `PLACE_DATABASE_CONNECTION_TIMEOUT_MILLISECONDS` from 1 through 60,000;
- `PLACE_MEMBERSHIP_POLICY_FILE` containing one strict `place-membership-policy.v1` JSON document;
- `PLACE_AUTH_MODE=oidc`; and
- `PLACE_OIDC_ISSUER`, `PLACE_OIDC_AUDIENCE`, `PLACE_OIDC_JWKS_URI`, and
  `PLACE_OIDC_REQUIRED_SCOPES`.

The membership policy contains `requiredConsents`, `initialUserGrade`, and `initialProductTier`.
Its published shape is `packages/contracts/membership/membership-policy.v1.schema.json`. There is no
repository default for documents, versions, grades, or tiers. Test auth remains rejected by the
production loader.

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

Cleanup is rejected above 1,000 rows per table per call. The actual Next process calls this
loader only through its Node instrumentation lifecycle, which installs once before readiness,
registers signal close, schedules non-overlapping retryable cleanup, and shares the runtime with
reviewed auth route bundles through a process-global symbol. A separate membership lifecycle owns
only the stateless backend client and has an independent fail-closed activation switch. It uses fixed
readiness, current-consent, and onboarding paths, rejects redirects, and never publishes its origin
or bearer to the browser. Web `/readyz` checks both activated runtimes and maps timeout, non-2xx, or
database failure to a sanitized 503. Mounted deployment secrets, Identity
provisioning, and Gateway validation remain required before callback activation. An operator must
not substitute direct secret values or process memory for login transactions or sessions.
