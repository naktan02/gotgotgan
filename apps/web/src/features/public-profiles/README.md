# Public Profiles feature

`PublicProfileSettings`는 현재 회원의 프로필 load/create/update/retry를 하나의 workflow 뒤에 숨긴다.
View는 Public Handle을 최초 생성 뒤 잠그고 표시 이름과 공개/숨김만 편집한다. 공개 링크는 Backend가
확인한 public 상태에서만 보여준다.

`PublishedProfile`은 `public-profile.v1`의 공개 Collection page만 렌더링하고 cursor를 이어 읽는다.
Collection 상세은 기존 publication URL로 위임하며 unlisted, membership, personal state를 알지 못한다.
페이지와 BFF 모두 외부 검색엔진 `noindex, nofollow` 정책을 유지한다.
