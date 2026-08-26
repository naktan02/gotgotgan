# Browser import platform

이 폴더는 브라우저와 Place Backend의 연결 계정 Import 경계를 소유한다. 브라우저는 Web BFF만
호출하며 access token, provider secret/profile reference, raw capture와 내부 Backend 주소를 받지
않는다.

- `import-backend-client.ts`는 배포가 주입한 단일 origin과 고정된 Import 경로만 호출한다.
- `browser-import-http.ts`는 서버 세션을 해석하고 모든 요청·응답을 Place Import 계약으로 다시
  검증한다.
- `next-import-lifecycle.ts`는 명시적 활성화와 bounded timeout을 소유하며 비활성 상태에서는
  fail closed 한다.
