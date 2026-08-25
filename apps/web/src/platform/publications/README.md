# 공개 콘텐츠 플랫폼 경계

Web 서버는 고정된 내부 Backend 주소에서 허용 목록으로 정의된 익명 공개 projection만
가져온다. redirect, 예상하지 않은 필드, 잘못된 응답 형식은 모두 거부한다. token,
membership, 비공개 Collection, Personal Rating, Visit, revision 데이터는 이 경계를 넘지
않는다.
