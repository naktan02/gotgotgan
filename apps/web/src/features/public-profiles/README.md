# Public Profiles feature

`PublicProfileSettings`는 현재 회원의 프로필 load/create/update/retry를 하나의 workflow 뒤에 숨긴다.
View는 Public Handle을 최초 생성 뒤 잠그고 표시 이름과 공개/숨김만 편집한다. 공개 링크는 Backend가
확인한 public 상태에서만 보여준다.

`PublishedProfile`은 `public-profile.v1`의 공개 Collection page만 렌더링하고 cursor를 이어 읽는다.
Collection 상세은 기존 publication URL로 위임하며 unlisted, membership, personal state를 알지 못한다.
페이지와 BFF 모두 외부 검색엔진 `noindex, nofollow` 정책을 유지한다.

`PublicProfileModerationInbox`는 소유자 Notice pagination, acknowledge와 구조화된 appeal을 별도 workflow
뒤에 숨긴다. 프로필 설정의 state나 CSS를 재사용하지 않고 `/profile` page가 두 공개 View만 조합한다.
최신 withheld Notice에 아직 appeal이 없을 때만 정해진 사유 선택을 제공하며 자유 서술과 첨부는 없다.
응답이 유실된 appeal 재시도는 같은 UUID와 payload를 사용하고 성공 뒤 owner projection을 다시 읽는다.
이 module은 reviewer 운영 UI, email/push delivery, 내부 사람 검색을 소유하지 않는다.
