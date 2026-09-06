# 제품 기본 분류

기본 계층의 제품 의도는 장소 유형과 음식 세부 종류를 탐색 가능하게 만드는 것이다. 회원이
만든 Collection 이름·Tag·메모와 관계없으며, 공급자 분류 코드의 공식 대응표도 아니다.
정확한 초기 정의는 `product-taxonomy.ts`, 제한적인 label 조회는 `match-product-taxonomy-label.ts`에 있다.
그 조회 결과도 실제 활성 taxonomy의 현재 version과 대조해야 한다. 계층은 점으로 구분된 key
문자열이 아니라 `parentKey`가 결정한다.

기존 설치를 보호하려고 migration이 아닌 명시적 owner provisioning을 선택했다. seed는 의미가
같은 기존 node/version을 그대로 두고, 의미가 다르면 전체 transaction을 취소한다. 이 경계와
회원 데이터 비변경은 `backend/tests/integration/product-taxonomy.test.mjs`에서 검증한다.
기존 node 자체를 바꾸지 않아도 새 하위 분류를 추가하면 상위 분류의 하위 포함 검색 범위가
넓어진다. 따라서 기존 taxonomy가 있는 환경에서는 의미 충돌 검사 통과만으로 자동 적용하지
않고, 추가될 계층과 검색 범위를 운영자가 검토한 뒤 명시적으로 실행한다.
새로운 분류/동의어를 추가할 때는 이 기본 분류를 무작정 덮어쓰지 말고 기존 version 의미와
구분해 검토한다. 수집 자료에 없는 세부 분류나 아이 동반 적합성은 추정하지 않는다.
