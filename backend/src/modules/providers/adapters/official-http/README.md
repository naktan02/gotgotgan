# 공식 HTTP 어댑터

`OfficialProviderHttpClient`는 세 어댑터가 반복하는 HTTP lifecycle만 감춘다: redirect 거부,
JSON/content-size 검증, timeout, throttle·일시 장애의 최대 2회 retry, bounded backoff와 안전한
오류 분류다. URL, 인증 헤더, field mask, pagination, 좌표, response schema는 각 provider
adapter가 소유한다.

- NAVER: 최대 5개, 문서화된 continuation 없음, bounds 후처리, 상세·사진 미지원.
- Kakao: 최대 15개, 1~45 page, server rectangle, 상세·사진 미지원.
- Google: 최대 20개 token pagination, server rectangle, 선택 시 Details와 사진 1개 지연 조회.

endpoint는 생성자 주입이며 production에서는 deployment environment가 공급한다. credential은
secret file에서만 읽어 server-side header로 사용한다. raw response, credential, request URL,
exception message는 Search/API outcome에 포함하지 않는다.
