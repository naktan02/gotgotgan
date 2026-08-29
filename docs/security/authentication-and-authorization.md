# Authentication and authorization

Place는 토큰 서명, 발급자, 대상, 시간 클레임과 주체를 검증한 다음 `(issuer, subject)`로 로컬
멤버십을 찾는다. 로그인 요청의 `openid` 범위를 액세스 토큰 클레임으로 다시 요구하지 않는다.
`member`, `reviewer`, `administrator`, `owner`는 보호되는 Place Authority Role이다. User Grade는
권한이 아닌 참여·평판·혜택 분류이고, Product Tier는 별도의 상업 기능·할당량 축이다. 둘 다 관리자
권한을 부여하지 않는다. 모든 리소스 작업은 Place 권한과 해당하는 마지막 Owner 보호를 적용한다.

No credential means an anonymous visitor, not an implicit guest. A verified but unmapped principal
is rejected rather than downgraded to anonymous. Anonymous access is limited to an explicitly public
projection. Login and token validation do not create a Place row. Just-in-time onboarding requires
the verified principal to accept the complete server-selected current consent document/version set.
One transactional store operation creates or resolves the membership, records consent versions, and
appends the audit outcome; a retry never changes existing membership status, role, grade, or tier.
New self-service memberships receive the non-elevated `member` Authority Role unless the Backend has
verified a current Identity-issued `platform_owner` assertion for the exact principal and Place
audience. In that one case the same transaction creates the Membership and projects it as the sole
local `owner`. Initial User Grade and Product Tier remain injected Place policy rather than
browser-chosen authority.

Place records allow and denial decisions through an audit port without retaining raw tokens. Stage 3
provides normalized PostgreSQL membership/resource-grant/consent storage, append-only audit, and
legacy operator-authorized initial-owner bootstrap persistence. The bootstrap operation serializes the
empty-membership decision and membership/audit write in one transaction; browser input can never
trigger it. These adapters remain source-only until an approved process composition owns the pool.

When `PLACE_PLATFORM_ACCESS_ENABLED=true`, Place sends the already presented access token only to
Identity's private entitlement Interface. It verifies the returned ES256 assertion's type, issuer,
audience, exact principal, expiry, authority revision, and owner revision. Migration `000018`
enforces one local Owner and stores a projection checkpoint. A newer owner revision demotes the old
Owner to the preserved prior Place role and promotes the new one in one audited transaction. The
token itself is never persisted or included in audit evidence.

The browser login boundary is a confidential BFF. It validates HTTPS callback configuration,
requires `openid`, rejects external post-login redirects, consumes one-time server-side login
transactions, validates state/nonce/PKCE through the OIDC adapter, bounds session lifetime by token
expiry, and sanitizes callback failures. Cookies are `__Host-`, Secure, HttpOnly, SameSite=Lax and
contain opaque identifiers only. Logout deletes server-side session state before clearing the cookie.
In-memory stores are not an allowed production composition. The PostgreSQL adapter encrypts complete
transaction and token payloads with AES-256-GCM before storage, binds their kind/ID/expiry/key ID as
authenticated data, atomically consumes transactions, and supports retained decryption keys during
rotation. Protected one-line secret-file configuration supplies the database URL, confidential client
secret, and rotatable keyring. The Web process factory owns a bounded pool, at-most-1,000-row expired
record cleanup per table, and explicit close operation. Reviewed browser-auth handlers exist
source-only and fail closed; no Identity/Gateway deployment connection is active.

The source-only onboarding HTTP transport accepts only bounded consent document/version pairs. It
derives the External Principal exclusively from verified bearer evidence and derives Authority Role,
User Grade, and Product Tier exclusively from Place policy or the existing membership. Malformed JSON,
unsupported browser fields, stale consent, and persistence failures return correlated safe problems
without credential, database, or verifier details. The production HTTP composition does not register
this transport until its verifier, policy, ID source, and transactional store are supplied.

The Web exposes a separate strict onboarding boundary: it resolves the opaque session on the server,
uses its access token only in the server-to-server backend request, rejects redirects, and validates
the backend success projection before returning it. The browser cannot submit a token, principal,
role, grade, or tier through this operation. A public current-consent read contains no membership
defaults or authority information.

Authority-role changes go through the `access` module's single mutation interface. Administrators
can manage only `member`, `reviewer`, and `administrator`; the HTTP contract cannot assign `owner`.
A centrally projected Owner cannot be changed through this local path. Persistence performs
expected-role comparison, managed-owner protection, mutation, and outcome audit atomically; a
concurrent update returns a conflict instead of being overwritten. User Grade and Product Tier
remain outside this authority path.
The optional administration HTTP transport performs authentication and actor membership resolution
before the use case can inspect a target, preventing unauthorized membership enumeration. It exposes
only the requested role outcome and stable sanitized failures.

Public Profile 신고는 모든 활성 Authority Role의 `profiles.report` 권한을 요구한다. 운영 대기열 조회와
allowed/withheld 판정은 `reviewer`, `administrator`, `owner`에만 있는 `profiles.moderate`를 요구한다.
이 권한들은 Profile/Report persistence에 검증된 membership ID만 전달하며 browser가 role이나 reporter를
제출할 수 없다. `member`는 moderation route에서 target을 조회하기 전에 403으로 거부된다.
