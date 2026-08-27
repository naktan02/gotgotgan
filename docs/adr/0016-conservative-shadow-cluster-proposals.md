# Shadow 군집은 전이 폐쇄가 아니라 모든 구성원 쌍의 근거를 요구한다

Status: accepted

Date: 2026-08-28

Resolution은 `A≈B`, `B≈C`만으로 `A=B=C`를 만들지 않는다. confidence가 높은 edge부터 결정적으로
검토하되 두 군집의 모든 교차 구성원 쌍이 같은 policy에서 `likely-same`일 때만 합친다. 근거 없음,
`needs-review`, `likely-different`, 또는 같은 Provider의 중복 구성원이 있으면 합치지 않는다. 이
보수성은 일부 실제 동일 장소를 singleton으로 남기는 대신 프랜차이즈·지점·층이 연쇄 오병합되어
Canonical Place와 개인 Library로 전파되는 위험을 줄인다.

결과는 immutable versioned Place Cluster Proposal, normalized member, supporting Match Assessment
관계로 shadow 저장한다. Provider별 고정 열과 Canonical mutation은 두지 않는다. 실제 다중 Provider
평가에서 clique 요구가 지나치게 낮은 recall을 만든다는 증거가 쌓이면, hard-negative 제약을 유지한
다른 correlation-clustering 정책을 새 policy version으로 추가한다.
