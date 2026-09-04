# Maps

운영 Web 지도 Adapter는 MapLibre GL JS 6.7.0이며 기본 style은 OpenFreeMap의 OSM 기반
`https://tiles.openfreemap.org/styles/liberty`다. 배포 시 공개 style URL은
`PLACE_MAP_STYLE_URL`에 query/hash 없는 same-origin 경로나 공개 OpenFreeMap URL로 주입한다. 설정은
Node process instrumentation에서 검증하므로 내부 host, credential, signed query가 브라우저 HTML에
노출되지 않으며 잘못된 값은 시작을 실패시킨다. OpenFreeMap 공개 서비스에는 SLA가
없으므로 트래픽과 가용성 요구가 커지면 같은 MapLibre Interface를 유지한 채 style과 tile을 자체
호스팅한다. Provider credential이나 NAVER·Google·Kakao SDK는 브라우저 지도에 주입하지 않는다.

MapLibre Adapter는 생성 후 projection을 `globe`로 한 번만 지정한다. 낮은 zoom의 3D 지구본과 높은
zoom의 Mercator 2D 지도 전환은 MapLibre 내장 전환에 맡기며 zoom에 따라 projection을 수동 교체하지
않는다. Initial camera는 기본적으로 caller의 bounds를 그대로 사용한다. 빈 Home idle 화면만
`granted-current-location`을 opt-in하고, 브라우저 권한이 이미 `granted`인 경우에만 현재 위치로
한 번 이동한다. Search·Library·Browse·Published는 주입된 viewport를 유지한다. Geolocate control은
사용자 클릭으로만 권한을 요청하고 `prompt`, `denied`, 확인 불가 상태에서 자동 권한 창을
열지 않는다.

Canonical Catalog Home의 목록과 지도는 서로 다른 bounded projection이다. 목록은
`POST /v1/search/catalog`, 지도는 `POST /v1/search/catalog/map`을 사용한다. 지도 요청은 query,
제외 token, antimeridian-aware viewport와 zoom을 전달하고 최대 384개의 feature를 받는다. 넓은
범위에서는 서버가 count-bearing cluster를, 상세 범위에서는 Place marker를 반환하므로 전체 장소를
브라우저에 보내 client clustering하지 않는다. Web BFF는 지도 요청 32KiB, 응답 1MiB를 streaming
검사하고 압축·초과·비 JSON 응답을 닫는다.

Personal Library와 공개 Collection도 목록 page를 marker source로 재사용하지 않고 각 소유 모듈의
viewport projection을 사용한다. 모든 feature는 provider-neutral `PlaceMapRenderer` Interface만 알고,
app 조립 계층이 운영 MapLibre Adapter를 주입한다. Canvas source와 같은 feature를 나타내는 MapLibre
DOM Marker button이 키보드·screen reader 선택 Interface를 제공한다.

길찾기는 곳곳간이 구현하지 않는다. 유효한 좌표를 Google Maps와 Kakao Map 링크로 전달하며, 한국
좌표의 NAVER는 공식 app route scheme을 사용하고 해외 좌표는 NAVER Web 검색을 사용한다.
Web CSP는 same-origin과 `tiles.openfreemap.org`, MapLibre의 blob worker만 지도 자원으로 허용한다.
다른 tile host로 전환할 때는 먼저 same-origin proxy/self-hosting과 CSP 변경을 함께 검토한다.
React 개발 진단에 필요한 `unsafe-eval`은 `next dev`에서만 허용하며 production build의 CSP에는
포함하지 않는다.
CI와 feature 단위 테스트는 `platform/maps/testing`의 결정적 Adapter와 same-origin 빈
MapLibre style을 사용하므로 OpenFreeMap 네트워크에 의존하지 않는다.
