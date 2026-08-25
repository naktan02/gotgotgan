# 장소 검색 기능

이 feature는 검색 입력과 debounce/cancellation, Taxonomy filter, cursor pagination, 목록·지도
선택 상태, bounds 재검색, mobile 표시 전환을 소유한다. Backend 주소나 계약 해석, 지도 provider
SDK는 소유하지 않고 각각 `platform/search`, `platform/maps`의 공개 경계를 사용한다.

`public.ts`만 상위 shell/app의 진입점이다. 내부 component를 다른 feature가 직접 import하지
않는다. 개인 filter를 추가할 때 browser가 membership ID나 authority를 만들게 하지 않는다.

Stage 6부터 결과 선택은 canonical Place ID가 아니라 source-neutral `resultId`로 동작하고 각
행은 로컬 색인 또는 공식 provider 출처를 표시한다. 원문 링크가 있으면 새 탭으로 열며,
`detailsAvailable`인 Google 결과만 선택 시 `/api/search/provider-details`를 호출한다. Provider
Rating은 Personal Rating과 섞지 않고 사진 작성자 attribution을 상세 영역에 보존한다.
Provider credential, endpoint, raw response는 feature state나 browser request에 존재하지 않는다.
