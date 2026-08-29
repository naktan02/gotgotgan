# 지도 Renderer 경계

이 platform owner는 좌표와 viewport를 화면에 표현하고 marker/pan interaction을 feature에
전달한다. 검색, Place 정체성, provider detail, attribution 정책은 소유하지 않는다.

`place-map-interface.ts`가 bounds/zoom viewport, marker·count-bearing cluster와 이를 그리는
`PlaceMapRenderer`의 provider-neutral Interface를 정의한다. Stage 5의 `DeterministicPlaceMap`은 실제
좌표 기반 E2E용 provider 없는 Adapter이며 Search·Library·publication 계약을 직접 import하지 않는다.
각 feature가 projection과 선택 state를 소유하고 app 조립 계층이 renderer를 주입한다. fake renderer
주입 단위 테스트는 feature가 concrete Adapter에 결합되지 않았음을 검증한다.

Personal Library와 공개 Collection은 목록 page가 아니라 각자의 별도 viewport projection을 사용한다.
향후 live NAVER·Google·Kakao Adapter는 feature state나 provider SDK 응답을 서로 누출하지 않고 이
Renderer Interface만 구현한다. Adapter 선택, SDK lifecycle, key와 attribution은 platform/app 조립의
책임이며 현재 live Adapter는 없다.
