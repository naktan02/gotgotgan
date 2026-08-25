# 장소 검색 기능

이 feature는 검색 입력과 debounce/cancellation, Taxonomy filter, cursor pagination, 목록·지도
선택 상태, bounds 재검색, mobile 표시 전환을 소유한다. Backend 주소나 계약 해석, 지도 provider
SDK는 소유하지 않고 각각 `platform/search`, `platform/maps`의 공개 경계를 사용한다.

`public.ts`만 상위 shell/app의 진입점이다. 내부 component를 다른 feature가 직접 import하지
않는다. 개인 filter를 추가할 때 browser가 membership ID나 authority를 만들게 하지 않는다.
