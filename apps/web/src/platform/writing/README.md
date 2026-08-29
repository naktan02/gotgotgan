# Web Writing platform

회원 Writing 목록·상세와 private Note command를 same-origin route로 중계한다. 고정 Backend
transport와 좁은 인증 session Interface만 소비하며 bearer token과 Backend origin을 브라우저에
노출하지 않는다.

브라우저 command는 Note 생성·수정 필드만 받는다. Adapter가 `visibility: private`를 서버에서
고정하므로 브라우저가 publication ID나 공유 visibility, Entry command를 이 경로에 섞을 수 없다.
optimistic version, revision, replay/conflict 판정은 Backend Writing owner가 계속 담당한다.
