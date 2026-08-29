# Public Profile platform

이 경계는 현재 회원의 공개 프로필 설정 요청에만 opaque browser session의 bearer를 붙이고, 익명
프로필 조회에는 bearer를 보내지 않는다. Backend 성공 응답은 `@place/contracts/profiles`로 다시
검증하며 member ID, External Principal, unlisted Collection 같은 추가 field가 섞이면 실패한다.

공개 BFF는 `no-store`와 `X-Robots-Tag: noindex, nofollow`를 함께 보낸다. 외부 검색엔진 노출을
활성화하는 설정이나 sitemap은 이 경계에 없다.

소유자용 `GET /api/profile/moderation-notices`,
`PUT /api/profile/moderation-notices/{noticeId}/acknowledgement`,
`POST /api/profile/moderation-appeals`도 같은 authenticated Profile Adapter를 사용한다. route handler는
얇은 위임만 하고 Adapter가 query/body/path와 Backend 성공 응답을 strict contract로 검증한다.
browser request에는 member, role, operator나 access token을 받지 않으며 Backend bearer는 server에만
머문다.
