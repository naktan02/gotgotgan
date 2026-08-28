# Visit과 Rating

Visit은 안정적인 ID, 방문 시각, 기록 시각, 선택적인 회원 evidence를 가진 변경 불가능하고
반복 가능한 occurrence다. 동일한 요청의 재시도는 허용하고, 같은 ID를 다른 내용으로
재사용하면 conflict로 처리한다. 최초 방문, 최근 방문, 방문 횟수, 방문 여부는 query
projection으로 파생한다.

Web은 Visit ID, Place ID, 방문 시각만 제출한다. Provider나 내부 수집 pipeline이 소유할 evidence를
브라우저가 임의로 만들 수 없다. 응답 결과를 알 수 없을 때는 새 Visit을 만들지 않고 동일한 ID와
payload를 재전송하며, 이력은 bounded cursor projection으로 읽는다.

Personal Rating 이력은 Visit이 아니라 Library가 소유한다. Visit 이력과 Rating 이력은
모두 비공개이며 익명 Collection·Writing projection에서 제외한다.
