# Library 모듈

Library는 회원의 저장·가고 싶음 상태, 현재 Personal Rating, 평점 변경 이력, Collection,
Tag, 복사 provenance를 소유한다. Visit은 소유하지 않으며 `visited` 상태를 별도 flag로
저장하지 않는다.

application interface는 멱등 domain command를 받는다. persistence는 table별 repository가
아니라 하나의 깊은 adapter로 제공한다. 공개 Collection 조회는 owner ID, Tag, Rating,
Visit, private record를 반환할 수 없는 별도 허용 목록 projection을 사용한다.
