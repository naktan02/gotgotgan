# Privacy and sharing

Private is the default for personal library data, visits, ratings, notes, entries, imports, and
provider connections. Public and explicitly shared projections enumerate allowed fields rather than
filtering a private record after serialization. Authorization-denial tests cover every new projection.

Stage 4 public Collection projection에는 publication ID, visibility, 이름, 설명, 정렬된 Place
ID와 순서, 갱신 시각이 포함된다. Stage 11C의 `place-published-collection.v3`은 이를 전체 수와
publication/version-bound 50개 cursor page로 제한하고, 이름, 지역, 좌표, Taxonomy, 공개 evidence로
제한한 Place summary 또는 projection 지연을 뜻하는 `null`만 더한다. 별도 공개 map projection은
publication membership의 좌표와 count-bearing cluster만 반환하며 목록 page나 개인 Library row를
입력으로 사용하지 않는다.
public Writing projection에는 publication ID, visibility, 글 종류,
공개 본문, 연결한 Place ID, 갱신 시각만 포함한다. 이 query는 owner membership, 저장·가고
싶음 preference, Personal Rating과 이력, Tag, Visit, 복사 provenance, Writing revision을
선택하지 않는다. Web도 동일한 허용 목록을 검증하고 예상하지 않은 Backend field를 거부한다.

Collection publication mutation은 일반 `library.write`와 구분한 `library.share` 권한으로 Product
Authorizer를 통과하고 owner-scoped row lock과 optimistic `updatedAt`을 사용한다. 브라우저는
publication ID를 제출하지 않는다. 공유 해제는 ID를 제거하고 공개 조회는 같은 허용 목록 query에서
not-found가 된다. 복사는 Place ID와 순서만 새 private Collection에 넣으며 source owner, Rating,
Tag, Visit, Writing, Import provenance는 읽거나 복사하지 않는다.
별도 cache purge가 없는 현재 단계의 공개 Collection/map/Writing 응답은 `no-store`로 전달해 해제 전
projection이 browser나 중간 cache에 남는 시간을 허용하지 않는다.

Public Profile 설정은 `library.share` 권한을 통과하고 browser가 member, role, tier를 제출하지 않는다.
첫 Public Handle은 고정되며 표시 이름과 hidden/public 상태만 optimistic `updatedAt`으로 바꿀 수 있다.
익명 projection은 Handle, 표시 이름, `public` Collection의 publication ID·이름·설명·Place 수·갱신
시각만 허용한다. owner membership ID, private/unlisted Collection, preference, Rating, Tag, Visit,
Writing, provenance는 선택하거나 직렬화하지 않는다. hidden과 unknown Handle은 같은 404다.

Profile 또는 Membership 삭제는 공개 projection과 Membership 연결을 제거하지만 Public Handle
reservation은 retired 상태로 보존한다. retired Handle도 unknown과 같은 404이며 다른 Membership claim과
재활성화를 DB에서 거부한다. 따라서 과거 공개 URL이 새 회원 identity로 넘어가지 않는다. 원 소유자
복구는 Identity 증거와 운영 절차가 정해지기 전까지 지원하지 않는다.

현재 공개 프로필과 모든 `/share/...` HTML은 `noindex, nofollow` robots metadata를 사용한다. 공개
프로필 Backend/BFF JSON도 `X-Robots-Tag: noindex, nofollow`를 반환한다. 이는 외부 검색엔진 색인을
허용하지 않는 제품 정책이며 sitemap이나 discovery feed를 만들지 않는다. 공개 URL 자체의 직접 접근을
인증으로 막는다는 뜻은 아니다. 전역 사람 검색·팔로우·댓글이 없으므로 이 단계는 별도 abuse queue나
tier quota를 발명하지 않고, 그러한 노출 면을 추가하기 전에 정책과 운영 owner를 먼저 정한다.

공개 Collection에서 선택한 장소 상세은 `GET /api/public/places/{placeId}`로 지연 조회한다. Web 서버는
Backend에 bearer evidence를 보내지 않으며 `PublicPlaceDetailResponse`가 이름·지역·좌표·Taxonomy·공개
evidence와 redirect identity 외의 field를 거부한다. 특히 optional-member Backend route가
`personalState`를 반환하면 이를 제거해 전달하는 대신 전체 성공 응답을 fail closed한다.

Stage 5 익명 검색은 공개 Place projection만 반환한다. 저장·가고 싶음·방문·Personal Rating
filter는 verified membership과 `search.read` 권한이 있을 때만 실행하며 membership ID를 browser
입력으로 받지 않는다. 회원별 signal은 Search 소유 별도 table에서 membership으로 격리하고,
다른 회원의 값이나 identifier가 결과·오류·cursor에 노출되지 않는지 실제 PostGIS로 검증한다.
