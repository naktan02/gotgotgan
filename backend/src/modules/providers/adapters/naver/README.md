# NAVER adapter

Stage 7에는 `place-naver-saved-capture.v1` 비식별 캡처 parser와 acquisition port가 있다. 정상
목록과 로그인 만료, MFA, CAPTCHA, 동의, rate limit, schema drift를 구분한다. 공개 문서로
확인되지 않은 NAVER 내부 endpoint나 selector는 코드에 넣지 않는다. 실제 test account 관찰 후
acquisition leaf와 replay fixture만 추가하며 공통 Import 계약은 바꾸지 않는다.

NAVER의 공식 검색과 향후 connected-account import, structured-web parser, browser interaction,
outbound save 구현을 이 폴더에 둔다. Stage 6에는 Local Search 공식 API만 있으며 안정 ID,
pagination, 상세, 사진 능력을 추정하지 않는다. Stage 7 자동화는 이 검색 파일을 확장하지 않고
별도 adapter leaf로 추가한다.

`NaverTraceForgePlaceDetailSource`는 version-pinned NAVER Pack 결과의 bounded DOM output을
provider-neutral 상세 snapshot으로 해석한다. Ingestion의 Job port는 구조적 타입으로 만족하며 이
Adapter는 Ingestion 내부를 import하지 않는다. Runner client seam은 composition root가 주입하고
호출 취소용 `AbortSignal`을 함께 받는다. Google 공식 Details는 이 browser Adapter와 독립적이다.
