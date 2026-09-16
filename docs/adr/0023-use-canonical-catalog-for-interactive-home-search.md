# 0023: 대화형 홈 검색은 Canonical Catalog만 사용한다

Status: accepted

Date: 2026-09-03

## Context

곳곳간은 NAVER·Google·Kakao의 실시간 검색 결과를 한 화면에 중계하는 지도 검색 서비스가 아니다.
외부 서비스에 이미 저장한 사용자 목록을 서비스별로 가져오고, 운영 수집원이 모은 증거를 검수해
하나의 Canonical Place 카탈로그로 발행한 뒤 사용자가 그 카탈로그를 탐색하고 자기 Collection에
정리하는 서비스다.

기존 대화형 검색 Interface는 Local 결과와 Provider 결과, Provider 상세 조회를 함께 허용했다.
이 구조는 검색 응답 시간과 가용성을 Provider에 결합하고, 외부 identity를 Canonical Place처럼
보이게 하며, 가져오기·운영 수집·사용자 탐색의 서로 다른 수명주기를 한 경로에 섞는다. 또한 이전
화면은 `saved`와 `wanted`를 즐겨찾기처럼 표현해 Collection membership을 유일한 즐겨찾기 기준으로
삼는 ADR 0021과 충돌했다.

## Decision

1. 사용자 홈 `/`의 대화형 검색은 Search가 소유한 versioned Canonical Catalog projection만 읽는다.
   결과 identity는 Canonical Place이고 Provider identity, raw payload, 실시간 상세·평점·사진을
   반환하지 않는다.
2. 검색 해석은 Backend가 실제로 판정한 Area, 장소 유형, 속성, 잔여 검색어 token과 exact version
   reference를 반환한다. Web은 그 token만 제거 가능한 칩으로 표시하며 임의 조건을 추론하지 않는다.
3. NAVER·Google·Kakao의 사용자 저장 목록은 설정의 서비스별 가져오기 workflow로, 운영 원천 데이터는
   별도 Admin application과 Ingestion worker로 들어온다. 둘 다 대화형 검색 요청의 Adapter가 아니다.
4. 공개 Browser BFF와 사용자용 OpenAPI에서 Provider 상세 조회 경로를 제거한다. 호환용 `/search`는
   새 홈으로 redirect하고 새 제품 동선은 `/` 하나만 소유한다.
5. 홈의 장소 정리 동작은 사용자 소유 Collection membership만 만든다. `saved` 또는 `wanted` boolean은
   즐겨찾기 판정과 화면 언어에 사용하지 않는다.
6. Web의 Catalog Home은 Personal Library의 좁은 공개 port만 주입받는다. 지도 장애나 좌표 부재는
   목록 탐색과 Collection 정리를 막지 않는다.

## Consequences

검색 응답과 화면 의미가 Provider 가용성에서 분리되고 모든 장소가 하나의 검수 가능한 identity로
표현된다. Provider 데이터의 provenance와 실패는 가져오기·수집 작업 이력에서 다룰 수 있다. 대신
새로운 Provider 장소는 수집, resolution, Profile 발행, Search projection 갱신을 거친 뒤에야 홈에
나타나며 실시간 Provider 검색보다 늦을 수 있다. 이 지연은 잘못된 identity와 사용자 Collection
오염을 피하기 위해 받아들인다.

## Supersession condition

향후 별도의 실시간 외부 장소 발견 제품이 명시적으로 승인되고, Provider 약관·표시 의무·비용·장애
격리와 외부 identity의 비영속 수명주기를 독립된 사용자 경험으로 설계할 때 새 ADR로 재검토한다.
가져오기 Provider가 늘거나 지도 renderer가 바뀌는 것만으로는 이 결정을 뒤집지 않는다.
