# 검색 Web 경계

브라우저는 같은 origin의 `/api/search/...`만 호출한다. 이 platform owner는 고정된 Backend
경로로 익명 공개 검색과 Taxonomy 조회를 전달하고, 공유 계약으로 요청·응답을 다시 검증한다.
Backend 주소, member ID, bearer token, 내부 오류는 브라우저 payload에 포함하지 않는다.
