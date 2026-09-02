# 곳곳간 Admin

곳곳간 운영자를 위한 별도 Next.js 애플리케이션이다. 사용자 앱의 메뉴를 권한에 따라 숨기는 방식이
아니라, 독립된 프로세스와 브라우저 세션 namespace를 사용한다.

현재 제공 범위는 관리자 OIDC 세션 수명주기, same-origin `/api/admin/session` 접근 게이트,
`/healthz`, `/readyz`, 운영 정보구조 셸이다. 장소 검수·수집·사용자·시스템 메뉴는 각 Backend
Interface와 BFF가 구현되기 전까지 비활성 상태로 표시된다. 운영 수치나 성공 상태를 샘플 데이터로
대체하지 않는다.

## 실행 경계

- OIDC 환경 변수 namespace: `PLACE_ADMIN_*`
- transaction cookie: `__Host-place_admin_oidc_tx`
- session cookie: `__Host-place_admin_session`
- Backend origin: 서버 전용 `PLACE_BACKEND_ORIGIN`
- 허용 Authority Role: `reviewer`, `administrator`, `owner`

브라우저에는 OIDC access/refresh token, Backend origin, 내부 자격 증명이 전달되지 않는다.
`member`는 로그인했더라도 관리자 앱에서 `403`으로 거부된다.

## 로컬 명령

```text
npm run typecheck --workspace @place/admin-web
npm run test --workspace @place/admin-web
npm run build --workspace @place/admin-web
```

실제 로그인을 활성화하려면 공유 browser-auth 패키지가 요구하는 `PLACE_ADMIN_*` 보호 설정과
Identity client를 배포에서 주입해야 한다. 설정이 없으면 앱은 시작 가능하지만 로그인과 readiness가
명시적으로 `unavailable`이다.
