# Visits 모듈

Visits는 변경 불가능하고 반복 가능한 Visit occurrence를 소유한다. `visited`, 최초·최근
방문, 방문 횟수는 occurrence에서 파생하는 query projection이다. 다른 모듈은 Visits
schema를 기록하거나 동일한 사실을 중복 저장하지 않는다.
