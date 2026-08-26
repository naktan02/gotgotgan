# 로컬 개발

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

로컬 스택은 하나의 `place` Compose 프로젝트 아래 `postgres`, `backend`, `web`을 둔다.
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
docker network inspect place-data-local
docker volume inspect place-captures-local
```

없는 리소스만 각각 `docker network create place-data-local`,
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

Place OIDC client 등록이 끝난 뒤 Identity 저장소에서 전용 DB role·migration·ES256 키·허용 audience를
한 번 준비한다. 이 단계는 사용자에게 역할을 부여하지 않는다.

```powershell
Set-Location C:\Users\PC\workspace\identity
.\scripts\initialize-platform-access.ps1 -Start
```

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

### 6. Connector 설치 전 확인

Web 로그인, Place 동의·membership 생성, 가져오기 페이지의 grant 발급까지 확인한 뒤에만
`apps/member-connector/.output/chrome-mv3`를 Whale/Chrome/Edge의 압축 해제 확장으로 설치한다.
Firefox는 별도 산출물을 사용한다. 현재 NAVER Adapter는 브라우저의 기존 로그인 세션을 사용한다.
Kakao·Google도 같은 Connector 경계 안에 별도 Provider Adapter로 추가하며, 어느 경우에도 계정
비밀번호를 Place 서버로 전송하거나 저장하지 않는다.

## 릴리스 준비

로컬 릴리스 준비는 GHCR에 접속하거나 게시하지 않는다.

```powershell
node scripts/prepare-application-release.mjs verify-source --repository-root .
npm run test:deployment
```

커밋 태그 이미지는 수동 GitHub workflow만 게시한다. 로컬 빌드나 Compose 검증은 게시된
아티팩트 증거가 아니다.
