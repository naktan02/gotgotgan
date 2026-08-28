# Visits Web 플랫폼

이 seam은 브라우저의 opaque session을 서버에서 해석하고 배포가 정한 하나의 Place Backend에만
bearer token을 전달한다. 브라우저에는 현재 회원의 versioned Visit 기록 결과와 bounded 이력만
반환하며 membership ID, fingerprint, evidence, Backend 주소는 노출하지 않는다.

- `visit-backend-client.ts`는 고정된 Visit 경로와 bounded timeout을 소유한다.
- `browser-visit-http.ts`는 identifier, query, body, Backend 응답을 계약으로 다시 검증한다.
- feature는 same-origin `/api/visits`, `/api/places/{placeId}/visits` Interface만 사용한다.

권한 판정과 불변 occurrence 규칙은 Backend의 Product Authorizer와 Visits 모듈에 남는다.
