# Maps

The renderer is a frontend platform adapter, not the Place search or identity source. The initial
live candidate is NAVER Web Dynamic Map for Korean usability; CI uses a deterministic fake. MapLibre
remains a fallback after a reviewed Korean tile/style source exists. No key or origin is present.

Stage 5는 실제 좌표와 viewport bounds를 사용하는 `DeterministicPlaceMap`을 구현하지만 tile,
SDK, key는 연결하지 않는다. list selection과 marker selection은 같은 state이고 map 이동 뒤
사용자가 명시적으로 “이 영역 검색”을 선택한다. Stage 6 live renderer는 이 interaction과
Search 계약을 유지한 채 platform 구현만 교체한다.
