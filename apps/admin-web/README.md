# 곳곳간 Admin

곳곳간 운영자를 위한 별도 Next.js 애플리케이션이다. 사용자 앱의 메뉴를 권한에 따라 숨기는 방식이
아니라, 독립된 프로세스와 브라우저 세션 namespace를 사용한다.

현재 제공 범위는 관리자 OIDC 세션 수명주기, same-origin `/api/admin/session` 접근 게이트,
`/healthz`, `/readyz`, 운영 정보구조 셸과 `/catalog` 읽기 전용 장소 조회다. 장소 검수·수집·사용자·시스템 메뉴는 각 Backend
Interface와 BFF가 구현되기 전까지 비활성 상태로 표시된다. 운영 수치나 성공 상태를 샘플 데이터로
대체하지 않는다.

장소 데이터는 기존 내부 공개 카탈로그 검색과 canonical 공개 상세 계약만 소비한다. 검색·페이지
조회·선택 상세는 `/api/admin/catalog` BFF를 통과하고 매 요청마다 관리자 세션을 재검증한다.
카탈로그 Backend 호출에는 bearer나 cookie를 전달하지 않아 개인 메모·방문·평점이 포함되지 않는다.
상세 projection 지연, 폐기, 조회 실패는 그대로 표시한다. 원본 수집 데이터와 모든 canonical 장소를
망라하는 운영 조회가 아니며, 병합·삭제·분류 변경이나 moderation UI도 활성화하지 않는다.

`features/catalog-inspection`이 검색·선택 요청 취소와 화면 상태를 소유하고 `platform/catalog`는
고정 Backend 경로·서버 권한 확인·strict projection 검증을 숨긴다. Route는 이 경계만 호출한다.

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

별도 Admin 서버를 실행한 뒤 `PLACE_ADMIN_E2E_BASE_URL`에 해당 테스트 주소를 주입하고 저장소
루트에서 `npx playwright test --config tests/admin-e2e/playwright.config.ts`로 화면 회귀를 검증한다.
이 suite의 session/catalog 응답은 Playwright가 테스트에서만 대체하며 production 로그인 검증을
뜻하지 않는다. 실제 BFF 권한 거부와 비공개 필드 거부는 Admin 단위 테스트가 별도로 검증한다.

실제 로그인을 활성화하려면 공유 browser-auth 패키지가 요구하는 `PLACE_ADMIN_*` 보호 설정과
Identity client를 배포에서 주입해야 한다. 설정이 없으면 앱은 시작 가능하지만 로그인과 readiness가
명시적으로 `unavailable`이다.
