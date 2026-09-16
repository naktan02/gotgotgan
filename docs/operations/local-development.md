# 로컬 개발

## 현재 실행 기준

사용자 확인용 서버는 호스트의 `next dev`/`next start`가 아니라 `gotgotgan` Compose로 실행한다.
`package.json`의 `compose:local`이 실제 오버레이 조합을 소유한다. 준비된 환경의 재기동은
`npm run compose:local -- up -d --wait postgres backend web`, 별도 관리자 화면은
`npm run compose:local -- --profile admin up -d --wait admin-web`을 사용한다.
서비스명을 생략한 `up`은 승인 작업 처리 worker도 시작하므로 사용하지 않는다.

저장소 경로를 옮겼으면 기존 비밀 파일을 유지한 채 `prepare:local`로 파일 참조를 다시 생성한다.
옛 컨테이너를 단순 `start`하면 사라진 옛 bind 경로 때문에 시작 단계에서 실패할 수 있다.
[`local-runtime.test.mjs`](../../tests/deployment/local-runtime.test.mjs)는 경로 복구 시 키·비밀번호·
영속 볼륨이 유지되는지 검증한다. `PLACE_*`, DB 역할/이름, 기존 영속 볼륨 이름은 현재 저장 계약이다.
컨테이너의 제품명 변경과 함께 일괄 치환하거나 `down -v`로 초기화하지 않는다.

로그인 완료, 개인 Library 사용, 실제 Provider 가져오기는 각각 별도 확인이다. `/readyz` 성공만으로
이들이 검증됐다고 보지 않는다. 관리자 인증은 아래 별도 client 준비 조건을 따른다.

## 소스 검증

저장소 루트에서 의존성을 설치한 뒤 계약, Web, Backend를 각각 검증한다.

```powershell
npm install
npm run check:contracts
npm run check:web
npm run check:backend
```

브라우저 E2E는 테스트가 소유한 주소를 명시적으로 주입한다.

```powershell
$env:PLACE_WEB_E2E_BASE_URL='http://localhost:4177'
npm run test:e2e
```

## 전체 로컬 스택

로컬 스택은 하나의 `gotgotgan` Compose 프로젝트 아래 `postgres`, `backend`, `web`을 두고, 필요할 때
별도 `admin-web` 형제 컨테이너를 `admin` profile로 추가한다.
Identity와 Gateway의 소스나 데이터베이스를 가져오지 않고, 실행 중인 공통 Identity의 공개 OIDC
계약만 사용한다. 기본 주소는 코드에 고정하지 않으며 아래 실행 환경에서 주입한다.

### 1. 런타임 파일 준비

```powershell
$env:PLACE_LOCAL_PUBLIC_ORIGIN='http://localhost:3000'
$env:PLACE_LOCAL_IDENTITY_ORIGIN='http://identity.localhost'
npm run prepare:local
```

최초 실행 결과의 `state`는 `identity-client-required`이다. 이 명령은 `.runtime/local` 아래에
PostgreSQL 역할별 비밀번호와 URL, OIDC 세션 암호화 키링, 수집 원본 암호화 키링, 로컬 동의
정책을 한 번만 만든다. 재실행해도 기존 비밀을 교체하지 않는다. 출력과 `database.env`에는
비밀 값이 들어가지 않으며 `.runtime/`은 Git에서 제외된다.

### 2. 데이터베이스 준비

외부 네트워크와 수집 볼륨은 한 번만 만든다. 이미 존재하면 다시 만들지 않는다.

```powershell
docker network inspect gotgotgan-data-local
docker volume inspect place-captures-local
```

없는 리소스만 각각 `docker network create --internal gotgotgan-data-local`,
`docker volume create place-captures-local`로 만든다. 그다음 PostGIS와 일회성 마이그레이션
작업을 실행한다.

```powershell
docker compose --env-file .runtime/local/database.env `
  -f deploy/compose.database.yml `
  -f deploy/compose.yml `
  -f deploy/compose.local.yml `
  -f deploy/compose.local.integration.yml `
  up -d --wait postgres

docker compose --env-file .runtime/local/database.env `
  -f deploy/compose.database.yml `
  -f deploy/compose.yml `
  -f deploy/compose.local.yml `
  -f deploy/compose.local.integration.yml `
  --profile local-lifecycle run --rm database-prepare
```

마이그레이션 컨테이너는 완료 후 종료하며 상시 프로세스로 두지 않는다.

### 3. 로컬 OIDC 클라이언트 등록

운영용 `deploy/identity/oidc-client.json`과 로컬용
`deploy/identity/local/oidc-client.json`을 분리한다. 로컬 manifest만 `devMode=true`와 명시적인
localhost HTTP callback을 허용한다. Identity 운영자는 짧은 수명의 provisioning PAT와 대상
project ID를 사용해 Identity 저장소의 표준 provisioner를 실행한다. PAT와 발급된 client
secret은 명령 인자, 채팅, Git, 로그에 넣지 않고 보호된 파일 또는 secret sink로만 전달한다.

발급된 client secret은 `.runtime/local/secrets/place_oidc_client_secret`으로 직접 전달하고,
비밀이 아닌 client ID를 주입해 준비 명령을 다시 실행한다.

```powershell
$env:PLACE_LOCAL_OIDC_CLIENT_ID='<provisioned-client-id>'
npm run prepare:local
```

성공 결과는 `state=ready`이며 `.runtime/local/compose.env`가 생긴다. Identity 클라이언트 등록은
보안 경계를 바꾸는 작업이므로 사람 운영자의 명시적인 승인 없이 자동 생성하지 않는다.

### 4. Identity 플랫폼 권한 Backend 준비

기존 Identity의 private entitlement endpoint와 JWKS 연결을 먼저 확인한다. 새 DB 역할, 키,
audience나 Identity 서비스를 만드는 것은 이 프로젝트의 재기동 작업에 포함하지 않는다.
준비가 안 되어 있으면 Identity 운영자의 별도 승인을 받아 해당 프로젝트의 절차를 따른다.

Place Backend만 Identity의 비공개 `identity-services` 네트워크에 참가한다. 준비되지 않은 상태에서
`PLACE_PLATFORM_ACCESS_ENABLED=true`로 실행하면 권한 검증은 실패 폐쇄한다.

### 5. Web과 Backend 기동

```powershell
docker compose --env-file .runtime/local/compose.env `
  -f deploy/compose.database.yml `
  -f deploy/compose.yml `
  -f deploy/compose.local.yml `
  -f deploy/compose.production.yml `
  -f deploy/compose.local.integration.yml `
  up -d --wait postgres backend web
```

확인은 `http://localhost:3000/readyz`, `http://localhost:3001/healthz`,
`http://localhost:3001/readyz`에서 수행한다. Web만 브라우저 진입점이며 Backend의 공개 포트는
로컬 진단용이다. 운영 구성은 Backend를 Gateway나 브라우저에 노출하지 않는다.

### 선택: source-only Admin Web

`prepare:local`은 `.runtime/local/database.env`에 Admin image/listener와 기본 host port `3002`도
기록하지만 Admin Identity client나 비밀은 만들지 않는다. 다음 명령은 Admin container build와
`/healthz`만 확인하는 source-only smoke다.

```powershell
docker compose --env-file .runtime/local/database.env `
  -f deploy/compose.yml `
  -f deploy/compose.local.yml `
  --profile admin up -d --build --wait admin-web
```

`http://localhost:3002/healthz`는 `200`이어야 한다. 이 모드의 `/readyz=503`은 OIDC와 Backend
bridge를 의도적으로 활성화하지 않았다는 뜻이다. 인증된 Admin runtime에는 사용자 Web과 별개인
`deploy/identity/admin-oidc-client.json` provisioning, Admin client secret, Admin session keyring,
Admin DB URL secret이 필요하다. 현재 로컬 provisioner는 이 두 번째 Identity client를 준비하지
않으므로 해당 통합은 별도 운영 준비 전까지 integration-gated다.

Docker Desktop 재시작처럼 Web과 PostgreSQL이 동시에 시작되면 Web의 OIDC 수명주기는
`compose.env`의 bounded startup retry 정책 안에서 데이터베이스 연결을 다시 시도한다. 그동안
healthcheck는 준비 완료를 주장하지 않으며, PostgreSQL이 복구되면 Web 컨테이너를 수동 재시작하지
않고 `/readyz`가 회복되어야 한다. 재시도 횟수와 간격의 곱은 구성 로더가 최대 5분으로 제한한다.

### 6. 가져오기 활성화 경계

사용자는 Desktop·로컬 agent·확장을 설치하지 않는다. 공유 링크를 주 경로로 정한 이유와
활성화 조건은 [ADR 0025](../adr/0025-web-one-shot-saved-place-imports.md)를 따른다.
Compose 재기동은 공유 링크 수집, 원격 로그인, 상세 수집이나 freshness scheduler의 활성화 승인이
아니다. 설치형 Connector flag는 기본 off이며 기존 parser/계약의 존재와 제품 사용 가능성을 구분한다.

## 릴리스 준비

로컬 릴리스 준비는 GHCR에 접속하거나 게시하지 않는다.

```powershell
node scripts/prepare-application-release.mjs verify-source --repository-root .
npm run test:deployment
```

커밋 태그 이미지는 수동 GitHub workflow만 게시한다. 로컬 빌드나 Compose 검증은 게시된
아티팩트 증거가 아니다.
