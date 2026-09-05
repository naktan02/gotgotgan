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
