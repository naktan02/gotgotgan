# User journeys

Critical journeys are: authenticate; search and inspect evidence; save and classify; record visits
and ratings; write private or public notes/entries; connect a provider; preview and review an import;
reconcile duplicates; publish a selected view; and later invoke scoped AI Tools.

Every asynchronous journey exposes queued, running, needs-user-action, partial, failed, cancelled,
and completed states where applicable. A retry uses an idempotency identity and preserves evidence.

Stage 5의 검색 journey는 익명 공개 로컬 검색으로 시작한다. 사용자는 text와 data-defined
Taxonomy를 선택하고, 목록과 지도에서 같은 Place를 선택하며, 지도를 이동한 뒤 명시적으로
현재 영역을 다시 검색하고 cursor로 다음 결과를 읽는다. 새 입력은 debounce되고 이전 요청은
취소된다. 개인 저장·가고 싶음·방문·별점 filter는 verified membership이 있을 때만 허용한다.
한 source의 실패는 partial 상태로 표현하고 전체 실패·빈 결과·재시도는 서로 구분한다.
