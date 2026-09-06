# 빈 지도와 레이아웃 변경에 따른 검색 초기화

2026-09-05. 범위: 회원 Web, Next 16.3.0, MapLibre GL 6.7.0, Chromium.

## 증상과 처음 실패한 경계

기존 `2c5c488`에서 홈 지도가 계속 로딩 중이었고 아래쪽에 큰 빈 공간이 남았다. 공개 style,
TileJSON과 sprite 요청은 성공했지만 browser가 빈 URL로 module Worker를 생성했다. MapLibre는
`import.meta.url`에서 worker 상대 경로를 구하는데 Next 번들이 유효한 HTTP module URL을
보존하지 않았다. 진단용으로 올바른 worker와 상대 shared module을 제공하자 이 경계가 성공하고
실제 타일이 렌더링되었다.

레이아웃에는 보이는 자식 2개에 grid 행이 3개였다. 본문이 auto 행을 차지하고 마지막 비율 행이
비어 1440×1400에서 지도 높이가 520px에 머물렀다. worker 오류 및 비활성 인증/개인 Library의
503 응답과는 각각 독립된 원인이었다.

## 수정과 재발 검사

Maps owner가 설치된 버전의 worker/shared module/license를 Next dev/build 시 동일 출처의
versioned public 경로에 복사하고 renderer에 URL을 명시한다. Docker standalone target도 이
public 산출물을 포함한다. CDN script, 전역 Worker 교체나 CSP 완화는 사용하지 않는다.
홈은 높이가 제한된 하나의 작업 패널과 남은 공간을 채우는 지도로 구성한다.

모바일 조정 중 ResizeObserver의 MapLibre `moveend`가 영역 검색으로 해석되는 추가 문제가
확인되었다. 상세 선택·패널 크기 변경만으로 결과가 교체되었다. 레이아웃 resize 이벤트를 표시해
feature callback에서 제외하고 이미 컨테이너를 관측하므로 native resize 추적은 끈다. 사용자의
확대·이동은 요청 교체/취소와 300ms debounce로 검색에 반영한다.

지속 가능한 검사:

- `prepare-map-assets.test.ts`: 배포 module/license 해시와 설치 package의 일치.
- `tests/e2e/search.spec.ts`: 실제 worker, cluster 확대, 4개 폭의 높이·넘침, 같은 패널의 선택/
  복귀/접기와 검색 보존. 외부 네트워크를 사용하지 않는 fixture 검사.
- `platform/maps/testing/live-map-smoke.mjs`: 명시적 opt-in 프로덕션 빌드의 공개 타일/worker
  HTTP 검사, 1440/1280/390/360 캡처와 저배율 지구본. 네 폭 모두 browser 오류 없이 통과했다.

재발하면 타일 키나 인증을 바꾸기 전에 실제 Worker URL과 동일 출처 worker/shared 응답부터 본다.
style/TileJSON, worker, tile/font, renderer 경계를 각각 확인한다. 로그인/Library 503은 별도의
비활성 runtime 경계다. 지도 검사로 Identity 로그인, 개인 Library, 공급자 저장목록 가져오기나
운영 배포 성공을 주장하지 않는다.

## 2026-09-06: 드래그 뒤 카메라가 bounds 중심으로 되돌아감

같은 MapLibre 6.7.0에서 지구본을 드래그하면 실제 중심이 경도 0도로 돌아가고, 2D에서도
고위도에서 위도가 어긋났다. 첫 실패 경계는 SDK 입력이 아니라 `moveend → readMapViewport →
caller state → bounds prop → centerForBounds → jumpTo`였다. 지구본의 전 세계 bounds와
Mercator bounds의 위도 중간값은 현재 카메라 중심을 복원하지 못한다. 로컬 source와 실제 React
adapter/MapLibre를 사용한 회귀에서 드래그 중심 `[58.2768, 50.3145]`가 prop 반영 후
`[0, 27.2659]`로 바뀌는 red를 확인했다.

Adapter가 발행한 bounds 객체의 다음 echo만 소비하고 카메라는 그대로 둔다. 소비 후 새로운
bounds 객체로 요청하는 같은 값의 이동은 차단하지 않는다. 우클릭·키보드·두 손가락 회전과
pitch 입력은 차단하되 왼쪽 지구본 drag와 pinch zoom은 유지한다. 결정적 재발 검사는
`apps/web/src/platform/maps/testing/camera-roundtrip/run.mjs`이며 외부 타일, 계정 또는 운영
서버를 사용하지 않는다. 이 검사와 maps 단위 검사, Web typecheck가 통과했다.

같은 날 공개 Bright style의 국가/도시/POI/도로명 text-field가 Latin-first 병기식임을 확인했다.
언어 정책은 공급된 `name:ko`를 우선하며, 없으면 현지 이름과 영문으로 내려간다. 원본에 없는
한국어 번역을 만들었다고 주장하지 않는다. 도로번호와 공항 코드 등 이름이 아닌 필드는 유지한다.
출처는 [OpenFreeMap 안내](https://openfreemap.org/#attribution)와
[OSMF interactive-map 지침](https://osmfoundation.org/wiki/Licence/Attribution_Guidelines#Interactive_maps)에
따라 최초 표시 후 조작으로 접히고 다시 펼칠 수 있게 유지한다. 이 기록의 로컬 source 검사는
변경된 Compose Web의 실제 공개 Bright 타일/글꼴 렌더링 검증을 대신하지 않는다.

같은 날 수정된 Compose Web에서 별도 live-map-smoke를 실행해 공개 Bright 타일·worker의 HTTP 성공,
네 폭의 넘침/브라우저 오류 없음, 서울·축소 지구본의 한국어 지명 표시를 실제 캡처로 확인했다.
선택적인 OpenFreeMap 브랜드만 빠지고 필수 OSM/OpenMapTiles 고지는 남았다. 이는 공개 지도
렌더링 증거이며 회원 로그인, 비공개 가져오기 또는 상세 보강 활성화의 증거가 아니다.
