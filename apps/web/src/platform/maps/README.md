# 지도 Renderer 경계

이 platform owner는 MapLibre lifecycle, style, projection, viewport, marker·cluster 표현과 외부 지도
링크 정책을 소유한다. 검색, Place 정체성, 즐겨찾기, Provider detail은 소유하지 않는다.

호출자는 `public.ts`의 provider-neutral `PlaceMapRenderer` Interface만 사용한다. 운영 Adapter인
`maplibre/MapLibrePlaceMap.tsx`는 MapLibre GL JS를 한 번 생성하고 projection을 `globe`로 한 번만
지정한다. 지구본과 Mercator 2D 전환은 MapLibre 내장 zoom 전환에 맡기며 수동 projection toggle을
두지 않는다. feature의 Canvas source와 같은 DOM Marker button을 함께 유지해 키보드와 screen reader
선택도 목록 선택과 같은 callback을 지난다.

Map style은 server-rendered root에서 `PLACE_MAP_STYLE_URL`을 읽어 공개 DOM 설정으로 전달한다. 값은
same-origin path 또는 HTTPS URL만 허용하며 기본은 OpenFreeMap liberty style이다. OpenFreeMap 공개
서비스에는 SLA가 없으므로 운영 요구에 따라 style/tile을 자체 호스팅할 수 있고 feature 코드는
바뀌지 않는다. E2E는 `/api/maps/style`의 same-origin 빈 style을 사용해 외부 네트워크를 요구하지
않는다.

Initial camera의 기본값은 caller가 주입한 `supplied-bounds`다. 빈 Home의 idle 상태만
`granted-current-location`을 opt-in하며 Search·Library·Browse·Published는 자신의 viewport를 유지한다.
opt-in한 경우에도 이미 geolocation 권한이 `granted`일 때만 첫 카메라에 적용하고
`prompt`, `denied`, API 오류에서는 자동 요청하지 않는다. MapLibre Geolocate control 클릭은
언제나 명시적 사용자 동작으로 남겨 둔다.

`external-links`는 유효한 좌표를 Google·Kakao 길찾기에 전달하고, 한국 좌표는 NAVER app route를,
해외 좌표는 NAVER Web 검색을 사용한다. `testing/DeterministicPlaceMap`은 CI와 feature
테스트 전용 Adapter다. 운영 app은 이를 import하지 않고 `MapLibrePlaceMap`만 조립한다.
