# ADR 0017: 공개 핸들은 은퇴 뒤 재배정하지 않는다

- Status: Accepted
- Date: 2026-08-29

## Context

Public Handle은 직접 링크의 사람 identity다. Public Profile 행을 Membership과 함께 삭제한 뒤 같은
문자열을 다른 회원이 가져갈 수 있으면 기존 링크, 북마크, 메시지가 새 소유자를 가리키는 handle
takeover가 된다. 표시 이름과 달리 URL identity의 재사용은 삭제된 소유자의 공개 Collection을 새
사람의 것으로 오인하게 만들 수 있다. 아직 Identity 증거를 이용한 지원 복구 절차와 abuse 운영
owner는 정해지지 않았다.

## Decision

Profiles는 공개 projection과 별도로 `Public Handle Reservation`을 소유한다. 회원은 하나의 Handle을
처음 한 번만 예약할 수 있고 Public Profile은 그 활성 예약과 같은 Membership을 참조한다. hidden은
publication 상태만 바꾸므로 예약을 유지한다. Public Profile 또는 Membership 삭제는 예약에서
Membership 연결을 제거하고 `Retired Public Handle`로 전환한다.

은퇴한 Handle은 익명 조회에서 다른 알 수 없는 Handle과 같은 not-found이고, 런타임은 이를 다른
Membership에 배정하거나 다시 활성화할 수 없다. 현재 단계에는 self-service rename, 탈퇴 뒤 복구,
지원자 재배정 예외를 두지 않는다. 표시 이름은 계속 변경 가능하며 재사용 가능한 표현 값이다. 외부
검색엔진 색인과 내부 사람 discovery는 이 결정과 무관하게 금지 상태를 유지한다.

## Consequences

- 삭제된 공개 링크가 미래의 다른 회원을 가리키지 않는다.
- Profile 삭제는 공개 필드와 Membership 연결을 없애지만 Handle과 예약/은퇴 시각은 namespace
  안전을 위해 남는다.
- Handle namespace는 자동 회수되지 않으며 오탈자 rename과 탈퇴 뒤 복구도 아직 지원하지 않는다.
- Profiles persistence가 예약 claim과 Profile 생성을 한 transaction에서 처리하고, PostgreSQL
  constraint와 trigger가 삭제 연쇄와 재활성화 금지를 강제한다.
- 사람 discovery, 신고, moderation queue를 추가하기 전에는 별도의 identity·abuse·operations
  정책이 여전히 필요하다.

## Supersession condition

Identity가 원 소유자를 다시 증명하는 versioned recovery contract와 운영 owner를 제공하거나, 적용
가능한 보존 정책이 time-bound/pseudonymous reservation을 요구할 때 새 ADR로 복구·보존·재배정
규칙을 대체한다. 단순한 Handle 희소성만으로 다른 회원 재배정을 허용하지 않는다.
