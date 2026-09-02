# Provider transfers

이 모듈은 외부 서비스 연결, 불변 saved-place source snapshot, revisioned import plan,
그리고 outbound Collection preview/approval을 소유한다. `transfers` 스키마에는 토큰, 쿠키,
비밀번호, vault reference를 저장하지 않으며 HTTP projection에도 credential 필드가 없다.

`SavedPlaceSource`는 가져오기 관찰만, `SavedPlaceTarget`은 내보내기 대상 관찰과 preflight만
담당한다. Stage 9의 outbound 승인은 user preview approval receipt와 `approved` 상태까지만
기록한다. provider mutation, one-time execution authorization, item receipt, outcome-unknown
reconciliation은 Stage 10 worker 경계이며 이 모듈은 그 전까지 성공을 보고하지 않는다.

`ingestion`의 v1 connector/import batch는 legacy acquisition path다. 새 UI는 이를 새
Collection으로 자동 반영하지 않는다. 차기 cutover는 connection-bound v2 grant가 기존
capture를 이 모듈의 immutable snapshot으로 넘기고, 명시적 import-plan approval 뒤에만
materializer/worker가 실행되도록 해야 한다. 현재 production capability는 adapter가 조합되지
않으면 `integration-gated` 또는 `unavailable`로 응답한다.

Import materialization은 승인과 같은 요청에서 실제 수행된다. 여러 source list가 동일한
existing Collection을 대상으로 하면 source order로 직렬 처리하고 직전 Collection revision을
다음 materialization에 전달한다. 부분 실패 시 계획은 상세 mapping rejection과 함께
`blocked`가 되며 retry/resume orchestration은 Stage 10 작업으로 남는다.

Command receipt에는 최대 10,000개 item projection을 복제하지 않는다. accepted resource의
식별자와 승인 당시 revision만 보존하고 replay 시 현재의 owner-scoped projection을 다시 읽는다.
따라서 replay는 mutation을 반복하지 않지만 이후 별도 command로 revision이 전진했다면 최신
resource projection을 반환한다. snapshot identity digest에는 관찰 시각과 capture 시각을 모두
포함한다.

회원 lifecycle은 현 단계에서 의도적인 `ON DELETE RESTRICT`다. immutable source evidence와
승인 기록을 무심코 연쇄 삭제하지 않기 위해 raw membership delete를 허용하지 않는다. Stage 10은
보존 정책을 먼저 판정한 뒤 outbound item → outbound header → import item/mapping/plan → snapshot
item/list/header → connection observation/connection → command receipt 순으로 한 transaction에서
삭제하는 명시적 account-erasure/purge workflow를 제공해야 한다. 그 cutover 전 계정 해지는 논리적
비활성화로 처리하며 물리 삭제 성공을 가장하지 않는다.
