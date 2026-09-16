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

Stage 6에는 NAVER/Kakao/Google 공식 검색과 Google 지연 상세·사진이 있다. Stage 7은 별도 NAVER
저장목록 합성 capture parser와 실패 분류를 추가했다. Provider-neutral 상세 Job seam은 Ingestion에
있고, Providers의 NAVER TraceForge Adapter가 version-pinned Pack output을 그 Interface와 구조적으로
호환되는 snapshot으로 해석한다. Providers는 Ingestion 내부를 import하지 않으며 Google 공식 Details도
browser DOM 수집과 독립적이다. 실제 Playwright/Crawlee 수집과 outbound 저장은 아직 integration-gated다. 두 개 이상의 browser adapter가 실제로 같은 lifecycle을 공유하기
전에는 `platform/browser_runtime`을 만들지 않는다.

공통 `TraceForgeRunnerClient`는 Runner SDK process와 익명 profile의 시작·중단·정리만 소유한다.
Provider Pack 결과를 해석하지 않으므로 NAVER/Kakao/Google Adapter의 변경 이유와 섞이지 않는다.

외부 결과의 `resultId`는 화면 선택용 불투명 식별자다. provider가 문서화한 안정 ID만
`providerPlaceId`로 보존하며 canonical Place ID는 Ingestion/Resolution을 통과해야 생긴다.
