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

`build/prepare-map-assets`는 Next dev/build 단계에서 설치된 6.7.0 worker·상대 shared module·license를
동일 출처의 versioned public 경로에 복사한다. renderer는 그 worker URL을 명시한다. Docker Web target도
public 산출물을 함께 배포하며 production startup은 파일을 생성하지 않는다. 업그레이드 시 정확한
worker와 renderer 버전 결속을 재검토해야 한다. 패널/키보드 ResizeObserver는 map 크기만 갱신하고
사용자 지도 이동 callback을 호출하지 않는다. 지도 연결 실패는 목록과 분리해 다시 연결할 수 있다.

`testing/live-map-smoke.mjs <base-url> <output-directory>`는 명시적 opt-in 공개 타일 검사다. 로그인,
위치 권한, 개인 데이터나 fixture substitution 없이 4개 폭의 HTTP worker/타일과 실제 지도·지구본
캡처를 확인한다. 결정적 E2E와 분리해서 실행한다. 원인/재현은
[`지도 incident`](../../../../../docs/incidents/2026-09-05-map-worker-and-viewport.md)에 기록한다.
