# 공유와 추천

Sharing은 선택한 지도, Collection, Place, Writing에서 authorization을 통과한 projection만
공개한다. 다른 사용자의 지도를 보는 행위는 private field 접근 권한을 부여하지 않는다.
복사는 provenance를 가진 새로운 Library 관계를 만들며 mutable ownership을 공유하지 않는다.

public과 unlisted는 동일한 최소 projection 형식을 사용한다. public은 공개 프로필에 표시될 수 있지만
현재 외부 검색엔진 색인이나 전역 내부 discovery 대상은 아니다. unlisted는 불투명한 publication ID를
가진 사람만 접근할 수 있고 공개 프로필에는 표시되지 않는다.
private, 알 수 없는 ID, 잘못된 publication ID 모두 membership identity나 private field의
존재를 노출하지 않는다.

Collection 소유자는 private, unlisted, public을 바꿀 수 있다. 공유 해제 즉시 기존 publication ID는
조회되지 않으며 재공개는 새 ID를 쓴다. 보는 회원의 복사 operation은 원본을 공동 편집하지 않고
정렬된 Place reference와 source publication provenance만 가진 새 private Collection을 만든다.
공개 화면은 각 reference에 허용 목록 Place summary를 함께 보여줄 수 있다. summary가 아직 없으면
준비 중으로 남기고, 개인 Library 상태를 대신 조회하거나 UUID를 사용자용 장소명처럼 표시하지 않는다.

Public Profile은 로그인 principal이나 membership ID와 분리된 고정 Public Handle, 표시 이름,
hidden/public 상태만 소유한다. Handle은 첫 생성 뒤 변경하지 않아 기존 링크를 다른 identity로
재지정하지 않는다. Profile/Membership 삭제는 Handle을 retired reservation으로 바꾸고 다른 회원에게
재배정하지 않는다. 공개 projection은 owner의 `public` Collection directory만 bounded cursor로
조합한다. hidden, retired, 알 수 없는 Handle, 잘못된 Handle은 private identity를 드러내지 않는 동일한
not-found 경계로 처리한다. Public Profile Report는 인증된 회원의 categorized signal이고 자동 차단
결정이 아니다. Public Profile Moderation은 owner visibility와 독립된 allowed/withheld 운영 판정이며
immutable decision을 남긴다. 두 책임은 Profile identity Store와 분리된 Safety Interface에 있다.
withheld도 익명에게 같은 not-found이고 reporter identity는 공개·검토 projection에 없다. 사람 검색·
팔로우·댓글·추천은 아직 이 단계의 책임이 아니다.

Public Profile Moderation Notice는 withheld/restored/appeal-rejected 사실의 owner-scoped projection이고
외부 메시지 delivery가 아니다. Public Profile Appeal은 현재 withheld Decision 하나에 owner가 한 번만
제출하는 categorized 재검토 요청이다. Profile Appeal Resolution은 reviewer 이상의 immutable
accepted/rejected 판정이다. accepted만 같은 transaction에서 Moderation을 allowed로 복구하며 rejected는
target Decision을 유지한다. owner visibility는 어느 경우에도 별도 축이다.

향후 추천 기능은 privacy 검토를 통과한 projection을 입력으로 받고 versioned interface로
설명 또는 후보를 반환한다. 추천 infrastructure는 충분한 데이터와 별도 단계가 준비되기
전까지 활성화하지 않는다.
