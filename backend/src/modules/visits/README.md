# Visits 모듈

Visits는 변경 불가능하고 반복 가능한 Visit occurrence를 소유한다. `visited`, 최초·최근
방문, 방문 횟수는 occurrence에서 파생하는 query projection이다. 다른 모듈은 Visits
schema를 기록하거나 동일한 사실을 중복 저장하지 않는다.

`VisitStore`는 append와 파생 summary를, 별도 `VisitQueries` Interface는 현재 회원·Place 범위의
bounded history를 소유한다. PostgreSQL query Adapter는 `(visited_at DESC, id)` keyset cursor를
사용하고 HTTP projection에는 `visitId`, `visitedAt`, `recordedAt`만 내보낸다. 내부 member ID,
fingerprint, 임의 evidence는 목록 계약에 포함하지 않는다.
