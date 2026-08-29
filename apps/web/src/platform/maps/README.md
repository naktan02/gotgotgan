# 지도 Renderer 경계

이 platform owner는 좌표와 viewport를 화면에 표현하고 marker/pan interaction을 feature에
전달한다. 검색, Place 정체성, provider detail, attribution 정책은 소유하지 않는다.

`place-map-interface.ts`가 bounds/zoom viewport와 marker·count-bearing cluster의 provider-neutral Interface를
정의한다. Stage 5의 `DeterministicPlaceMap`은 이 Interface를 그리는 실제 좌표 기반 E2E용 provider
없는 renderer이며 Search 결과나 Library row 계약을 직접 import하지 않는다. Search와 Personal
Library가 각자 feature projection을 만들며 선택 state도 각 feature가 소유한다. Personal Library는
목록 page가 아니라 별도 viewport projection을 사용하고 deterministic renderer의 pan/zoom/cluster
interaction으로 live Adapter가 받을 Interface를 검증한다.
Stage 6에서 live adapter를 추가할 때 기존 feature state를 import하거나 provider SDK 응답을
feature로 누출하지 않고 이 Interface를 구현하는 renderer만 교체한다.
