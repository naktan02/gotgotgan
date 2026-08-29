# ADR 0019: 공개 프로필 appeal을 특정 withheld 판정에 결합한다

- Status: Accepted
- Date: 2026-08-30

## Context

Public Profile owner에게 withheld 사실과 재검토 경로가 없으면 직접 링크 moderation도 일방적인 차단이
된다. 반대로 appeal을 현재 상태와 무관한 자유 서술 ticket으로 만들거나 수락과 moderation 복구를
분리하면, 검토 중 다른 판정이 적용되거나 일부 transaction만 성공해 appeal 결과와 익명 공개 상태가
어긋날 수 있다. 일반 알림 infrastructure, 이메일·푸시 전달, support 대화, 내부 사람 discovery는 아직
준비되지 않았다.

## Decision

Profiles는 `Public Profile Moderation Notice`, `Public Profile Appeal`, immutable
`Profile Appeal Resolution`을 추가한다.

- 모든 moderation 판정은 같은 transaction에서 owner-scoped Notice를 만든다. Notice는 withheld,
  restored, appeal-rejected 중 categorized 사실과 acknowledgement만 제공하고 operator identity를
  노출하지 않는다. 현재 단계의 notification은 bounded in-product 조회함이며 외부 전달 성공을 뜻하지
  않는다.
- owner는 `profiles.appeal` 권한으로 자신에게 발행된 현재 withheld Notice 하나를 선택해
  mistaken-identity, issue-corrected, decision-context 중 하나로만 appeal할 수 있다. 자유 서술은 받지
  않는다.
- appeal은 정확한 Profile Moderation Decision을 가리키며 판정당 하나, Handle당 pending 하나로
  제한한다. 같은 appeal ID와 payload는 replay하고 다른 payload 재사용은 conflict다.
- `profiles.moderate`를 가진 reviewer 이상만 appeal을 resolve한다. accepted는 appeal resolution,
  `appeal-accepted` moderation decision, allowed 현재 상태, owner Notice를 한 transaction으로 기록한다.
  rejected는 immutable resolution과 owner Notice만 기록하고 withheld를 유지한다.
- pending appeal이 있는 Handle의 일반 moderation 변경은 거부한다. 검토자는 appeal resolution
  Interface를 사용해야 하므로 appeal을 우회해 현재 상태만 바꿀 수 없다.
- Profile 삭제는 pending appeal을 `superseded` resolution로 닫는다. owner Membership 연결은 삭제 시
  제거하지만 immutable categorized evidence는 운영 감사 목적으로 남긴다.

외부 검색엔진 색인과 내부 사람 discovery는 계속 금지한다. 이메일·푸시, 자유 서술 support, 자동
복구, AI 판정은 활성화하지 않는다.

## Consequences

- owner가 어떤 withheld 판정에 appeal했는지 안정적이고, 중복 제출이나 상태가 바뀐 판정에 대한 늦은
  수락을 DB transaction과 constraint가 막는다.
- accepted appeal만 공개 가능성을 복구한다. 실제 익명 공개에는 owner visibility도 계속 public이어야
  한다.
- 운영자는 일반 moderation route와 appeal resolution route 중 하나를 명시적으로 선택해야 한다.
- 영속 조회함은 프론트가 크게 바뀌어도 재사용할 수 있지만 active delivery를 보장하지 않는다.
- one-per-decision과 one-pending-per-Handle 제한은 초기 abuse 방어이며 실제 운영량 기반 rate policy를
  대체하지 않는다.

## Supersession condition

실제 운영에서 자유 서술·첨부 evidence, 법정 처리기한, 다단계 escalation, 외부 Trust & Safety system,
이메일·푸시 delivery receipt 또는 별도 support case가 필요해지면 새 ADR로 appeal/notification ownership과
retention을 대체한다.
