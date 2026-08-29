# Personal Library platform

이 경계는 브라우저의 opaque session을 서버에서 해석하고, 배포가 정한 하나의 Place Backend에만
bearer token을 전달한다. 브라우저에는 versioned Library/Place projection과 allowlisted problem만
돌려준다.

- `library-backend-client.ts`는 고정 Backend 경로, bounded timeout, query 직렬화를 소유한다.
- `browser-library-http.ts`는 query/body/identifier와 Backend 응답을 계약으로 다시 검증한다.
- feature 화면은 same-origin `/api/library/*`, `/api/places/*` Interface만 사용한다.

브라우저 command 계약은 새 Collection의 visibility/publication ID를 받지 않고 Adapter가 private을
고정한다. 공유 전환은 publication ID가 아닌 목표 visibility와 읽었던 `updatedAt`만 받는다.
`published-collection-copy.ts`는 공개 ID에서 private target을 준비하며, 응답 유실 재시도 동안 같은
command ID와 target Collection ID를 보존한다.

Product Tier와 Authority Role 판단은 이 Adapter에 넣지 않는다. 향후 등급별 정책은 Backend의 기존
Product Authorizer seam 뒤에서 적용하고, Web은 403 problem을 동일하게 처리한다.
