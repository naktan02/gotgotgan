# 지도 Renderer 경계

이 platform owner는 MapLibre lifecycle, style, projection, viewport, marker·cluster 표현과 외부 지도
링크 정책을 소유한다. 검색, Place 정체성, 즐겨찾기, Provider detail은 소유하지 않는다.

밀도가 다른 화면을 검토할 때는 `maplibre/marker-presentation.ts`에서 원/큰 유형/세부 유형의
확대 수준과 선택 label 우선순위, `MapPresentationControls.tsx`에서 동일 좌표의 별개 장소 선택을
확인한다. 없는 분류를 원문 문자열로 추측하지 않는다. v3의 동위치 미리보기는 일부 선택지이며
남은 수를 숨기지 않는다. 지도 표현상의 묶음은 장소 정체성이나 개인 Collection membership을 합치지 않는다.

지구본 표현은 MapLibre 6.7의 [공개 atmosphere 예제](https://maplibre.org/maplibre-gl-js/docs/examples/display-a-globe-with-an-atmosphere/)와
[Sky specification](https://maplibre.org/maplibre-style-spec/sky/)를 확인해 `maplibre/appearance/`에 한정한다.
Bright의 거리 지도는 유지하며 먼 zoom의 알려진 색상만 낮은 채도로 조정한다. 커스텀 shader·별 애니메이션·
projection 재생성은 쓰지 않는다. `testing/camera-roundtrip/appearance-smoke.mjs`는 공개 Bright 실제 타일의
세계/한국/서울/거리와 모바일 캡처, 동위치 선택창의 키보드·여백을 검증한다. 일반 CI fixture와 분리한
명시적 외부 네트워크 검증이며 운영 배포 상태의 증거는 별도 `live-map-smoke.mjs`가 소유한다.

호출자는 `public.ts`의 provider-neutral `PlaceMapRenderer` Interface만 사용한다. 운영 Adapter인
`maplibre/MapLibrePlaceMap.tsx`는 MapLibre GL JS를 한 번 생성하고 projection을 `globe`로 한 번만
지정한다. 지구본과 Mercator 2D 전환은 MapLibre 내장 zoom 전환에 맡기며 수동 projection toggle을
두지 않는다. feature의 Canvas source와 같은 DOM Marker button을 함께 유지해 키보드와 screen reader
선택도 목록 선택과 같은 callback을 지난다.

Map style은 server-rendered root에서 `PLACE_MAP_STYLE_URL`을 읽어 공개 DOM 설정으로 전달한다. 값은
same-origin path 또는 공개 OpenFreeMap HTTPS URL만 허용하며 기본은 OpenFreeMap Bright style이다. OpenFreeMap 공개
서비스에는 SLA가 없으므로 운영 요구에 따라 style/tile을 자체 호스팅할 수 있고 feature 코드는
바뀌지 않는다. E2E는 `/api/maps/style`의 same-origin 빈 style을 사용해 외부 네트워크를 요구하지
않는다.

지명 언어 정책을 변경하거나 도로번호가 사라진 경우 `maplibre/map-label-language.ts`와 해당
test에서 이름 전용 필드의 우선순위와 ref/code 보존 경계를 확인한다. 번역 데이터가 없는 지명을
자동 번역하지 않는다. 출처는 최초 표시 후 지도 조작 시 접히는 SDK compact control에 남기며
OpenStreetMap·OpenMapTiles 고지를 빈 문자열이나 CSS로 제거하지 않는다.

OpenFreeMap의 [공식 attribution 안내](https://openfreemap.org/)는 OpenFreeMap 브랜드 부분만
선택 사항으로 명시한다(2026-09-06 확인). `openfreemap-source/`는 정확한 공개 planet TileJSON
하나만 읽는 bounded adapter이며 알려진 선택 브랜드 anchor만 제외하고 나머지 동적 고지를 보존한다.
다른 URL·query·사용자 인증정보를 전달하는 proxy가 아니다. 실패하면 선택 브랜드 제거를 포기하고
고정 원본으로 redirect한다. 실제 SDK의 요청 대체·추가 고지 보존·redirect fallback은
`testing/camera-roundtrip/run.mjs`의 로컬 fixture에서 확인한다.

Initial camera의 기본값은 caller가 주입한 `supplied-bounds`다. 빈 Home의 idle 상태만
`granted-current-location`을 opt-in하며 Search·Library·Browse·Published는 자신의 viewport를 유지한다.
opt-in한 경우에도 이미 geolocation 권한이 `granted`일 때만 첫 카메라에 적용하고
`prompt`, `denied`, API 오류에서는 자동 요청하지 않는다. MapLibre Geolocate control 클릭은
언제나 명시적 사용자 동작으로 남겨 둔다.

`external-links`는 유효한 좌표를 Google·Kakao 길찾기에 전달하고, 한국 좌표는 NAVER app route를,
해외 좌표는 NAVER Web 검색을 사용한다. `directions/ExternalDirectionActions`는 단일 버튼에서
native modal로 지도 선택을 열며 초점 순환·닫기·초점 복귀를 같은 Chromium fixture로 검사한다.
`testing/DeterministicPlaceMap`은 CI와 feature
테스트 전용 Adapter다. 운영 app은 이를 import하지 않고 `MapLibrePlaceMap`만 조립한다.

`build/prepare-map-assets`는 Next dev/build 단계에서 설치된 6.7.0 worker·상대 shared module·license를
동일 출처의 versioned public 경로에 복사한다. renderer는 그 worker URL을 명시한다. Docker Web target도
public 산출물을 함께 배포하며 production startup은 파일을 생성하지 않는다. 업그레이드 시 정확한
worker와 renderer 버전 결속을 재검토해야 한다. 패널/키보드 ResizeObserver는 map 크기만 갱신하고
사용자 지도 이동 callback을 호출하지 않는다. 지도 연결 실패는 목록과 분리해 다시 연결할 수 있다.

`onViewportChange`는 검색 영역의 관측값이며 이동 명령이 아니다. 호출자가 그 bounds 객체를
state에 그대로 반영하는 한 번의 echo는 실제 카메라를 덮어쓰지 않는다. 명시적 이동에는 새로운
bounds 객체를 전달한다. `testing/camera-roundtrip/run.mjs`는 이 왕복과 날짜 변경선·고위도·반복
지구본 drag, 이후 같은 값의 명시적 이동, mouse/touch 북쪽 고정·pinch zoom, 언어 정책 적용과
출처 접근을 실제 React adapter/MapLibre로 검사한다. 저장소 root에서 `node`로 실행하며 임시
Vite/Chromium은 종료 시 정리한다. 로컬 source fixture 검사이지 공개 타일 또는 운영 연동 검사가 아니다.

`testing/live-map-smoke.mjs <base-url> <output-directory>`는 명시적 opt-in 공개 타일 검사다. 로그인,
위치 권한, 개인 데이터나 fixture substitution 없이 4개 폭의 HTTP worker/타일과 실제 지도·지구본
캡처를 확인한다. 결정적 E2E와 분리해서 실행한다. 원인/재현은
[`지도 incident`](../../../../../docs/incidents/2026-09-05-map-worker-and-viewport.md)에 기록한다.
