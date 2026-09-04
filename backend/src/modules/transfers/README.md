# Provider transfers

이 모듈은 외부 서비스 연결, 불변 saved-place source snapshot, revisioned import plan,
그리고 outbound Collection preview/approval을 소유한다. `transfers` 스키마에는 토큰, 쿠키,
비밀번호, vault reference를 저장하지 않으며 HTTP projection에도 credential 필드가 없다.

`SavedPlaceSource`는 가져오기 관찰만, `SavedPlaceTarget`은 내보내기 대상 관찰과 preflight만
담당한다. 승인된 outbound plan은 target과 순서가 고정된 execution manifest로 동결한다.
Connector mutation은 plan digest, verified account fingerprint, connection, installation, origin,
expiry와 사용량에 결속된 one-time authorization을 소비해야 한다. 성공·부분 실패·결과 불명은
item receipt와 reconciliation observation으로만 전진하며 preview 승인을 외부 성공으로 표시하지 않는다.

`ingestion`의 v1 connector/import batch는 legacy acquisition path다. production HTTP에는 v1
capture receiver를 더 이상 조합하지 않으며 새 UI가 이를 새 Collection으로 자동 반영할 수 없다.
connection-bound v2 grant만 sealed chunk manifest를 이 모듈의 immutable snapshot으로 넘기고,
명시적 import-plan approval 뒤에만 transfer materialization worker가 실행된다. provider adapter가
조합되지 않으면 capability와 실행은 `integration-gated`/`unavailable`로 fail closed한다.

Stage 10 이전의 `ready` connection observation에는 실행 권한을 결속할 account fingerprint가 없다.
이 행을 임의의 fingerprint로 보정하지 않고 connection 조회에서는 `action-required`/`reauthorize`로
투영한다. 새 verified observation이 fingerprint를 기록하기 전까지 capture, preview, execution grant는
모두 거절된다. Plaintext grant token은 저장하지 않으므로 동일 grant command replay 역시 새 권한을
가장하지 않고 fail closed한다.

Import 승인은 durable operation을 `queued`로 만들 뿐 요청 thread에서 Library를 변경하지 않는다.
별도 transfer materialization worker가 여러 source list를 source order로 처리하고, 동일한 existing
Collection에는 직전 receipt revision을 전달한다. 부분 실패는 계획을 `blocked`로 만들며 명시적
resume 후 lease/retry 경로로만 재개한다.

Connector manifest의 acquisition kind와 parser version은 획득 감사 정보이지 서버 attestation이
아니다. 미등록 Provider identity를 전역 Canonical Place로 만드는 계획은 서버 측 Provider detail
worker가 남긴 `available` observation과 normalized candidate가 있을 때만 세운다. Worker는 실행 시에도
계획에 FK로 고정된 동일 observation/candidate를 다시 확인하고 그 evidence ID를 resolution decision에
직접 연결한다. 상세정보가 갱신되어도 재시도는 최초 계획의 증거를 바꾸지 않으며, Place 생성 결과는
취소 종결보다 먼저 operation item에 체크포인트한다.

Chunk capture는 100,000 items까지 안전하게 저장·검증하지만 현재 snapshot detail/import-plan
projection은 50 lists, list당 500 items, 총 10,000 items로 제한된다. 이 경계를 넘는 snapshot은
저장 이력에는 보이되 승인 UI에서 materialization할 수 없다. Pagination/segment projection이
추가되기 전에는 일부만 가져온 것처럼 보이거나 승인 성공을 보고하지 않는다.

Command receipt에는 최대 10,000개 item projection을 복제하지 않는다. accepted resource의
식별자와 승인 당시 revision만 보존하고 replay 시 현재의 owner-scoped projection을 다시 읽는다.
따라서 replay는 mutation을 반복하지 않지만 이후 별도 command로 revision이 전진했다면 최신
resource projection을 반환한다. snapshot identity digest에는 관찰 시각과 capture 시각을 모두
포함한다.

회원 lifecycle은 의도적인 `ON DELETE RESTRICT`다. immutable source evidence와 승인 기록을 무심코
연쇄 삭제하지 않기 위해 raw membership delete를 허용하지 않는다. Stage 10의 account-erasure
command는 보존 정책 검토가 필요한 운영 작업만 만들고 `physicalDeletionPerformed: false`를 반환한다.
실제 purge는 보존 기간·법적 근거·감사 증거·실패 복구 순서가 별도 승인된 뒤에만 독립 workflow로
구현한다. 그 전 계정 해지는 논리적으로 비활성화하며 물리 삭제 성공을 가장하지 않는다.
