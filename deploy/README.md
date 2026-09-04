# Deployment declarations

`application-runtime.json` is the source-only machine-readable process and exposure contract. Web is
the only public Gateway-facing process. Admin Web is a separately deployable restricted Gateway
candidate, while Backend and Worker stay internal. Browser-to-Backend and cross-project database
connections are forbidden.

`compose.yml` is the port-free product base. It accepts only deployment-injected Web, Admin Web, and
Backend image references and keeps all Place processes under one product-owned Compose project and
its default network:

- `web`: standalone Next.js runtime;
- `admin-web`: opt-in `admin` profile with a standalone Next.js runtime;
- `backend`: Fastify HTTP runtime with explicit `source-only` or `production` mode; and
- `worker-check`: opt-in verification profile for the separately runnable worker artifact; and
- `worker-capture-sweep`: opt-in maintenance profile for one bounded legacy encrypted-file expiry sweep.

`compose.local.yml`만 Docker build target과 명시적 standalone host port를 추가하며 Web integration과
Backend transport는 기본적으로 source-only다. Admin Web은 `admin` profile을 선택했을 때 별도
`admin-web-runtime` target과 기본 host port `3002`를 사용한다. `compose.production.yml`은 Backend
production composition과 Web OIDC·membership·Import·Connector BFF를 활성화한다. 별도
`compose.admin.production.yml`은 Admin OIDC와 Backend bridge를 실패 폐쇄로 활성화한다. Backend와 선택적 보존 정리
Worker는 같은 보호 capture keyring과 외부 private capture volume을 사용한다. Backend host port를
게시하지 않고 live Provider acquisition이나 상세 보강 Worker를 활성화하지 않는다. 주소, 파일,
Pool 상한, timeout, issuer/audience/scope, Connector TTL·용량 상한과 policy는 모두 배포 입력이다.

Production image inputs must be immutable coordinates in the form
`<registry>/<repository>@sha256:<64 lowercase hex>`. Run `npm run plan:deployment` before an
activation or rollback. It requires `PLACE_DEPLOYMENT_OPERATION`, `PLACE_RELEASE_REVISION`,
`PLACE_WEB_IMAGE`, `PLACE_ADMIN_WEB_IMAGE`, and `PLACE_BACKEND_IMAGE`. Rollback additionally requires
the deployed release revision and all three images through `PLACE_DEPLOYED_RELEASE_REVISION`,
`PLACE_DEPLOYED_WEB_IMAGE`, `PLACE_DEPLOYED_ADMIN_WEB_IMAGE`, and
`PLACE_DEPLOYED_BACKEND_IMAGE`. The sanitized plan binds the three images as one Place application
unit and always preserves the database; migration rollback is application-only. This planner proves
selection and rollback intent, not publication provenance. A release still needs independently
verified digest, SBOM, provenance, and successful published-digest smoke evidence.

`release-source.v1.json` is the producer declaration for the one Place release revision. It binds
the `web-runtime` target to `place-web`, `admin-web-runtime` to `place-admin-web`, and
`backend-runtime` to `place-backend`, with the Backend image also owning Worker and migration
entrypoints. Its deployment state remains
`source-only`; it does not claim a Kustomize/Helm package, Gateway route, Identity client, or active
environment.

`.github/workflows/release-application.yml` is manual-only. It accepts only the current clean `main`
commit after the matching push CI succeeds, publishes `sha-<full-commit>` tags, resolves the
registry index back to exact `linux/amd64` platform digests, validates separate SBOM/provenance
evidence for all three images, and runs the Web, Admin Web, Backend, and Worker checks from those
published digests.
It then creates one checksum-bound `release-record.v1`; it has no GitOps, cluster, Gateway, or
deployment credential. A rerun never replaces a tag. If one image was published before a later
step failed, the workflow verifies that existing image's source/revision labels, publishes only the
missing checkpoint, and rebuilds all evidence. An unreadable tag state, foreign label, malformed
attestation, mutable reference, or mismatched digest fails closed.

Local verification does not publish anything:

```powershell
node scripts/prepare-application-release.mjs verify-source --repository-root .
npm run test:deployment
```

A successful workflow run is required before documentation may claim published release evidence.
Application activation additionally requires environment rollback smoke and the remaining
Identity/Gateway gates.

## 로컬 통합 오버레이

`compose.local.integration.yml`은 운영 오버레이를 수정하지 않고 로컬 통합에만 필요한 경계를
추가한다. `identity.localhost`의 host-gateway 해석, localhost HTTP OIDC의 명시적 허용,
PostGIS 준비 순서, 그리고 종료 후 제거되는 `database-prepare` 수명주기 작업이다. Web과 Backend는 기존
`compose.production.yml`의 실제 OIDC·membership·Import·Connector 조립을 그대로 사용하므로
로컬 전용 대체 인증이나 우회 API를 만들지 않는다.

Admin Web은 같은 Compose 프로젝트의 형제 컨테이너지만 기본 stack 기동에는 포함되지 않는다.
`prepare:local`은 사용자 Web용 Identity client 하나만 준비하며 Admin client를 복제하거나 같은
client secret·세션 keyring을 재사용하지 않는다. 따라서 아래 source-only 확인은 가능하지만 인증된
Admin 기동은 별도 `place-admin` Identity client, client secret, Admin OIDC keyring과 DB URL secret이
보호된 sink에 준비될 때까지 integration-gated다.

```powershell
docker compose --env-file .runtime/local/database.env `
  -f deploy/compose.yml `
  -f deploy/compose.local.yml `
  --profile admin up -d --build --wait admin-web
```

source-only Admin은 `http://localhost:3002/healthz`만 정상이다. OIDC와 Backend bridge가 없으므로
`/readyz`의 `503 unavailable`은 의도된 실패 폐쇄 상태다.

전체 순서와 명령은 [`../docs/operations/local-development.md`](../docs/operations/local-development.md)에
있다. `.runtime/local/database.env`는 데이터베이스 준비 단계에, OIDC client secret 전달 후
생기는 `.runtime/local/compose.env`는 전체 애플리케이션 기동 단계에만 사용한다. 두 파일은
비밀 값 대신 보호된 파일 경로를 전달하며 Git에 포함하지 않는다.

The Web OIDC configuration consumes `PLACE_DATABASE_URL_FILE`,
`PLACE_OIDC_CLIENT_SECRET_FILE`, and `PLACE_OIDC_ENCRYPTION_KEYRING_FILE`. A deployment secret sink
mounts those files read-only; direct credential environment values are unsupported. Non-secret
issuer, client ID, callback, scope, TTL, pool, and cleanup settings remain injected and fail closed.
Production overlay sets `PLACE_OIDC_RUNTIME_ENABLED=true`,
`PLACE_MEMBERSHIP_RUNTIME_ENABLED=true`, and `PLACE_IMPORT_RUNTIME_ENABLED=true`; false or missing keeps each source-only integration
disconnected, while any other value fails startup.

The Backend base defaults to explicit `PLACE_HTTP_RUNTIME_MODE=source-only` and registers lifecycle
routes only. Production overlay sets `production`; startup then requires the protected runtime URL,
bounded Pool values, strict `place-membership-policy.v1` file, and OIDC resource-server settings. An
initial database failure prevents startup and later failure makes both Backend and Web readiness
unhealthy.

`PLACE_PLATFORM_ACCESS_ENABLED=true` additionally requires the private Identity entitlement
endpoint, its JWKS URI, assertion issuer, the exact OIDC audience, and a bounded timeout. The local
integration overlay connects only Backend to the external `identity-services` network; Web and
PostGIS do not join it. Disabled mode preserves standalone development, while enabled verification
fails closed.

`identity/oidc-client.json` is the Place-owned, unprovisioned member Identity input. The provisioner expands
`PLACE_PUBLIC_ORIGIN`, delivers the generated client ID/secret through the approved secret sink, and
runs only after callback routes, shared session storage, Gateway routing, health validation, and
rollback are ready. The manifest contains no credential and does not activate Identity.

`identity/admin-oidc-client.json` is a second, unprovisioned confidential client. Its
`PLACE_ADMIN_PUBLIC_ORIGIN`, client ID, client secret, callback, cookies, transaction/session storage,
and encryption keyring are independent from member Web. Production Admin composition is explicit:

```powershell
docker compose --env-file <protected-production-env> `
  -f deploy/compose.yml `
  -f deploy/compose.production.yml `
  -f deploy/compose.admin.production.yml `
  --profile admin up -d --wait backend web admin-web
```

The Admin overlay requires `PLACE_ADMIN_DATABASE_URL_FILE`,
`PLACE_ADMIN_OIDC_CLIENT_SECRET_FILE`, and `PLACE_ADMIN_OIDC_ENCRYPTION_KEYRING_FILE`; omitted or
partial Admin OIDC configuration prevents activation. Admin Web joins the same Compose default
network for server-to-server Backend calls and the existing private `place-data` network only for its
session database.

`database-runtime.json` and `compose.database.yml` declare the source-only Place-owned physical
PostGIS runtime. The database Compose file remains under the `place` project, publishes no host port,
and requires deployment-injected administrator, migration, runtime, volume, and data-network inputs.
Production application composition is an activation input only. Disposable backup/restore and key
recovery now have source evidence, while environment promotion still waits for retained operational
backup evidence, published image/SBOM/provenance evidence, deployment rollback smoke,
Identity/Gateway, and public-path validation.

Validate overlay expansion without starting processes. Supply only test-owned placeholder files and
reserved-example endpoints:

```powershell
docker compose -f deploy/compose.yml -f deploy/compose.local.yml config
docker compose -f deploy/compose.yml -f deploy/compose.production.yml config
docker compose -f deploy/compose.database.yml config
```

The image base is digest-pinned. With Docker running, validate targets from the repository root:

`backend-runtime` 이미지는 `/var/lib/place/captures`를 `node` 소유의 `0700` 디렉터리로 미리 만든다.
새 named volume은 이 소유권을 상속해야 하며, 기존 volume을 재사용할 때는 배포 전에 Backend 실행
사용자가 해당 경로에 쓸 수 있는지 확인한다. 캡처 파일은 보호된 keyring으로 암호화된 뒤 이 private
volume에만 저장한다.

```powershell
docker build --target web-runtime --tag place-web-source .
docker build --target admin-web-runtime --tag place-admin-web-source .
docker build --target backend-runtime --tag place-backend-source .
```

Run the recovery rehearsal separately with Docker available:

```powershell
$env:PLACE_DATABASE_TEST_HOST='<test-owned-host>'
npm run test:database-recovery
```
