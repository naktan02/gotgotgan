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
아니다. 미등록 Provider identity는 안정적인 ID와 이름을 가진 최소 snapshot 근거로 생성할 수 있다.
새 V3 계획은 원본 snapshot item을 FK로 고정하고 Worker가 그 최소 정보를 immutable observation과
candidate로 정규화한다. 기존 상세 evidence 기반 승인 계획도 그대로 재생한다. 어느 경로도 기존
Canonical Place를 외부 payload로 덮어쓰지 않는다. 재시도는 최초 계획의 증거를 바꾸지 않으며, Place 생성 결과는
취소 종결보다 먼저 operation item에 체크포인트한다.

Trusted capture와 Connector capture가 SourceSnapshot을 기록하면 같은 transaction에서
Provider Place ID를 Ingestion의 최초 상세 예약 함수에 전달한다. Canonical 매칭 여부와 상세 보유 여부는
독립적이다. Transfers는 상세
상태나 Job lifecycle을 직접 쓰지 않으며 이미 상세가 끝난 identity의 재수집 정책도 소유하지 않는다.

V3 ImportPlan의 `refresh-evidence` command는 plan revision을 확인하고 draft plan 행을 잠근 뒤,
아직 사용자 결정이 없는 `unresolved`/`missing-identity` 항목만 현재 `available` 상세
observation/candidate 또는 유효한 최소 snapshot에 `policy-create`로 고정한다. `link`, `skip`, snapshot match와 이미 고정된
policy evidence는 다시 쓰지 않으며 여러 항목이 바뀌어도 plan revision은 한 번만 증가한다. 승인된
plan은 application 검사와 DB trigger 양쪽에서 불변이다. 변경할 항목이 없는 no-op refresh도
정상 command receipt를 남긴다. 이 명령은 기존 미결정 draft를 명시적으로 재검토할 때만 사용하며
새 가져오기 흐름의 선행 단계가 아니다.

V3 item의 `providerDetailStatus`는 `pending`/`available`/`unavailable`인 상세 Job의 현재 운영
상태를 보여주는 live projection이다. 이는 ImportPlan 결정이나 승인 snapshot이 아니므로 상태가
달라져도 `planRevision`은 바뀌지 않는다. `policy-create`라도 상세는 `pending` 또는 `unavailable`일 수
있으며 저장 승인을 막지 않는다. 상세 상태가 없으면 `null`이다. Web은 상세 완료를 기다리거나
`refresh-evidence`를 자동 호출하지 않는다. standalone plan
조회는 read-only repeatable-read snapshot을 사용하고 command 내부 projection은 plan shared lock을
사용해 plan revision과 item 결정이 서로 다른 시점에서 섞이지 않게 한다.

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

## 연결 변경과 Capture 권한 폐기

연결 해제·재인증 요청·인증 필요 관측은 같은 transaction에서 해당 연결의 활성 Import grant를
`revoked`로 바꾼다. 새 `ready` 관측의 계정 fingerprint가 달라지면 이전 계정 grant만 폐기한다.
동일 계정 재확인과 표시 이름 변경은 진행 중인 Import를 중단하지 않는다. 재연결은 폐기된 token을
복원하지 않으며 새 command로 발급한 grant만 기존 sealed manifest와 업로드 prefix를 재개할 수 있다.
완료된 capture의 token도 폐기 후에는 status·chunk replay·complete receipt를 조회할 수 없지만,
이미 저장된 snapshot과 회원 인증 작업 이력은 지우지 않는다.

2026-09-05 회귀 검사에서 연결 변경 후 이전 token으로 status·upload·complete가 모두 수락되는
증상을 임시 PostGIS에서 재현했다. 원인은 Connection lifecycle이 grant 폐기까지 소유하지 않았던
것이다. 수정은 lifecycle transaction에 한정하며 Capture의 기존 grant lock과 검사 경계는 유지한다.
연결의 키를 바꾸지 않는 lifecycle/발급 lock은 `FOR NO KEY UPDATE`를 사용한다. 따라서 이미 grant를
잠근 complete의 snapshot FK `KEY SHARE`와 교착하지 않으며, 먼저 승인된 complete가 끝난 뒤 폐기가
commit되고 그 이후 모든 이전 token 요청이 거절된다. 신뢰되지 않은 Origin이나 계정 식별자를
허용하는 변경은 아니다.

[회귀 테스트](../../../tests/integration/transfer-operations/connection-grant-revocation.test.mjs)는
폐기·재인증·계정 교체·인증 필요 상태, 같은 계정 재연결, command replay, 완료 receipt 비노출,
in-flight complete와 폐기의 잠금 경합을 실제 DB 경로로 검증한다. 이는 source-only Backend 검사이며
실제 Desktop·Provider 로그인 연결 완료를 뜻하지 않는다.
