# Maps

The renderer is a frontend platform adapter, not the Place search or identity source. The initial
live candidate is NAVER Web Dynamic Map for Korean usability; CI uses a deterministic fake. MapLibre
remains a fallback after a reviewed Korean tile/style source exists. No key or origin is present.

Stage 5는 실제 좌표와 viewport bounds를 사용하는 `DeterministicPlaceMap`을 구현하지만 tile,
SDK, key는 연결하지 않는다. list selection과 marker selection은 같은 state이고 map 이동 뒤
사용자가 명시적으로 “이 영역 검색”을 선택한다. Stage 6 live renderer는 이 interaction과
Search 계약을 유지한 채 platform 구현만 교체한다.

Personal Library map은 Search와 다른 interaction을 사용한다. 현재 목록 page를 marker source로 쓰지
않고 인증된 `GET /v1/library/map`에 member-owned scope/filter, bounds, zoom을 전달한다. 응답의 point와
cluster는 현재 viewport의 모든 projected Place를 대표하고, 넓은 영역에서는 feature 수만 최대 500개로
제한한다. cluster count의 합과 개별 point 수의 합은 `representedPlaceCount`와 같아야 한다. Library는
Search schema를 join하지 않으며 Search-owned PostGIS reader가 scoped Place ID의 bounds 조회를 수행한다.
CI의 deterministic renderer는 확대·축소·pan·cluster 확대를 검증하고 live NAVER Adapter는 후속이다.
