# Providers 모듈

Providers는 외부 지도 공급자의 능력과 응답 해석을 소유한다. Search, Ingestion, Sync는
provider SDK나 raw response를 알지 않고 공개 module interface만 조립한다.

```text
domain/       공급자 key, capability descriptor, 검색·상세의 provider-neutral 값
application/  provider별 상세 reader 선택처럼 공급자 내부 조정만 수행
adapters/     공식 HTTP, 향후 export/structured-web/browser 구현
transport/    bounded 상세 projection을 제공하는 Place Backend HTTP
tests/        redacted raw fixture replay, 실패 분류, opt-in live smoke
```

Stage 6.5는 provider-neutral suggestion port도 추가한다. Google은 문서화된 Places Autocomplete와
서버 전용 session token을 사용한다. NAVER Local과 Kakao keyword는 현재 search fallback임을
capability에 명시하고 서로의 응답 형태를 흉내 내지 않는다.

Stage 6에는 NAVER/Kakao/Google 공식 검색과 Google 지연 상세·사진만 있다. 계정 연결, 저장 목록
가져오기, Playwright/Crawlee, outbound 저장은 구현되지 않았다. 두 개 이상의 browser adapter가
실제로 같은 lifecycle을 공유하기 전에는 `platform/browser_runtime`을 만들지 않는다.

외부 결과의 `resultId`는 화면 선택용 불투명 식별자다. provider가 문서화한 안정 ID만
`providerPlaceId`로 보존하며 canonical Place ID는 Ingestion/Resolution을 통과해야 생긴다.
