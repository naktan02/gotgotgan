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

Stage 7.7의 개인 Library journey는 인증된 사용자가 저장됨·가고 싶음·평가함 상태를 전환하고,
안정된 Tag ID 여러 개를 all/any로 조합하거나 명시적 순서의 Collection을 선택해 Place를 찾는다.
선택한 Place는 개인 상태와 evidence를 별도 상세 projection으로 확인한다. desktop은
Collection/목록/상세 작업 공간, mobile은 같은 의미를 세로 흐름으로 유지한다. session 부재,
빈 결과, loading, failure, pagination을 구분하고 브라우저에 bearer token을 노출하지 않는다.

Stage 7.8에서 선택한 Place의 `내 분류`는 서비스 전역 카테고리를 제시하지 않는다. 현재 회원이
직접 만들었거나 NAVER 같은 Provider 저장 목록에서 가져온 Collection과 Tag를 페이지 단위로
가져와 현재 포함 여부를 함께 표시한다. 사용자는 그 기존 항목을 즉시 연결·해제할 수 있고 모든
변경은 멱등 command를 거친다. 항목 수가 많아도 아직 읽지 않은 소속을 추측하지 않으며, Google,
Kakao 수집이나 AI 자동분류가 없어도 이 수동 흐름은 동작한다.
