# 가져온 스냅샷을 먼저 개인 Library에 저장한다

- 상태: accepted
- 날짜: 2026-08-27

연결 목록의 안정된 Provider Place Identity와 회원의 명시적 저장 의도가 있으면 Provider 상세 조회를
기다리지 않고 Source Snapshot으로 Canonical Place를 만들거나 연결한 뒤 private Collection에 멱등
저장한다. 상세는 `(provider_key, provider_place_id)`별 독립 상태와 후속 Job으로 보강하며, 실패하거나
아직 지원되지 않아도 이미 저장된 개인 Library를 되돌리지 않는다.

상세 상태는 `pending`과 `available`을 사용하고 `available`은 정규화된 Source Observation을 반드시
참조한다. 후속 Job은 `pending`이거나 참조 관찰이 유효하지 않을 때만 실행한다. Source List·Source
Item·Provider Place ID 출처는 각각 보존해 재수집과 상세 관찰이 같은 원본을 찾도록 한다.

Provider가 안정된 공식 저장·상세 계약을 제공해 한 transaction에서 같은 가용성과 장애 격리를
보장하거나, snapshot만으로 Canonical 후보를 만드는 오류율이 승인 기준을 넘으면 이 결정을 재검토한다.
