# 공개 콘텐츠 플랫폼 경계

Web 서버는 고정된 내부 Backend 주소에서 허용 목록으로 정의된 익명 공개 projection만
가져온다. redirect, 예상하지 않은 필드, 잘못된 응답 형식은 모두 거부한다. token,
membership, 비공개 Collection, Personal Rating, Visit, revision 데이터는 이 경계를 넘지
않는다.

`browser-publication-http.ts`가 collection/writing 응답, 404·503 변환, 공개 cache와 problem
보안 header를 함께 소유한다. 동적 Next route는 path parameter를 읽고 이 interface에 위임한다.

Collection 응답은 `place-published-collection.v2`를 엄격히 검증한다. 각 정렬 행은 공개 Place
summary 또는 projection 지연을 뜻하는 `null`만 허용하며, Personal Rating·Tag·Visit 같은 예상하지
않은 field가 섞이면 page에 전달하지 않는다.
