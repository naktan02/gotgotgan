# ADR 0018: 공개 프로필 신고와 moderation 판정을 분리한다

- Status: Accepted
- Date: 2026-08-30

## Context

직접 링크 Public Profile도 사칭, 괴롭힘, 개인정보 노출, 스팸, 위험 콘텐츠 신고가 필요하다. 그러나
신고 하나가 자동으로 공개를 중단하면 악의적인 신고가 검열 권한이 되고, owner의 hidden/public 상태에
운영 차단을 덮어쓰면 복구와 감사에서 누가 어떤 결정을 했는지 구분할 수 없다. 전역 사람 discovery,
소유자 알림, appeal 운영 owner는 아직 준비되지 않았다.

## Decision

Profiles는 `Public Profile Report`, 현재 `Public Profile Moderation`, immutable
`Profile Moderation Decision`을 서로 다른 record로 소유한다.

- 활성 Membership은 `profiles.report` 권한으로 현재 published/allowed Profile만 신고할 수 있다.
- 신고는 `impersonation`, `harassment`, `privacy`, `spam`, `unsafe-content` 중 하나만 저장하고 자유
  서술, token, External Principal, 공개 Profile snapshot을 저장하지 않는다.
- 같은 reporter와 Handle은 보존 기간 안에 한 번만 신고할 수 있다. 신고는 180일 뒤 bounded cleanup으로
  삭제되며 reporter Membership 삭제 시 연결만 제거한다.
- 신고는 publication을 자동 변경하지 않는다. `reviewer`, `administrator`, `owner`만
  `profiles.moderate` 권한으로 allowed/withheld 상태를 판정한다.
- moderation 상태는 owner visibility와 독립적이다. 익명 공개는 두 축이 모두 public/allowed일 때만
  가능하며 withheld는 hidden/unknown과 같은 not-found다.
- 판정은 actor Membership ID, 이전/다음 상태, 분류 사유, 시각을 immutable history로 남기고 해당
  Handle의 현재 pending 신고를 reviewed로 닫는다. 운영 queue는 reporter identity를 반환하지 않는다.

현재 단계는 Backend safety Interface만 제공한다. owner notification, appeal 접수/처리, 내부 사람
discovery와 외부 색인은 활성화하지 않는다. 이 기능들이 준비되기 전에는 공개 프로필 증폭을 금지한다.

## Consequences

- 신고 남용이 즉시 공개 차단 권한이 되지 않고, 운영 판정과 접근 권한 모두 감사된다.
- owner가 hidden으로 바꾸거나 다시 public으로 바꿔도 platform withheld 상태는 사라지지 않는다.
- reporter identity는 DB의 제한된 보존 record에만 있고 moderation 응답이나 익명 projection에 없다.
- 180일 cleanup timer는 HTTP runtime lifecycle에 포함되며 한 번에 bounded row만 삭제한다.
- owner 알림과 appeal이 없으므로 내부 discovery를 시작할 수 없고, moderation은 직접 링크 안전 기반에
  한정된다.

## Supersession condition

실제 운영량과 abuse 측정이 다른 보존 기간, 익명 신고, risk-based 자동 임시 제한 또는 별도 Trust &
Safety runtime을 요구할 때 새 ADR로 대체한다. 자동 제한은 false-positive/appeal/rollback evidence 없이
추가하지 않는다.
