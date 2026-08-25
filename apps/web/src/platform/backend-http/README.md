# 고정 Backend HTTP 경계

이 platform owner는 여러 Web server adapter가 공유하는 고정 Backend origin/path 검증과
redirect/cache 차단만 소유한다. 인증, membership, publication, search 응답의 의미나 schema는
각 소비 owner가 소유한다.

새 호출이 두 곳 이상에서 같은 연결 규칙을 실제로 사용할 때만 이 경계를 확장한다. 임의 URL,
browser 입력 origin, provider endpoint 또는 인증 token 정책을 넣지 않는다.
