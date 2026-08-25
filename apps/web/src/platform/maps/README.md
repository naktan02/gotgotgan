# 지도 Renderer 경계

이 platform owner는 좌표와 viewport를 화면에 표현하고 marker/pan interaction을 feature에
전달한다. 검색, Place 정체성, provider detail, attribution 정책은 소유하지 않는다.

Stage 5의 `DeterministicPlaceMap`은 실제 좌표 기반 E2E를 위한 provider 없는 renderer이다.
Stage 6에서 live adapter를 추가할 때 기존 feature state를 import하거나 provider SDK 응답을
feature로 누출하지 않고 이 경계에서 교체한다.
