# 0026: 적격한 Provider 장소 기본정보를 공통 카탈로그에 기여한다

- 상태: accepted
- 날짜: 2026-09-09

회원 가져오기에서 Provider가 직접 제공한 원래 상호, 주소, 좌표, 원문 분류, Provider 장소 ID와 관찰 출처는 Provider별 이용조건을 만족하는 경우 `Shared Catalog Contribution`으로 사용할 수 있다. 회원의 목록명, `Personal Alias`, Tag, Note, Personal Rating, Visit과 회원 식별정보는 공통 Profile이나 Search에 들어가지 않는다. 첫 적격 관찰은 비어 있는 최소 필드를 채우고 이후 관찰은 필드별 근거·언어·출처·최신성 정책으로 보완하며, 기존 선택값을 단순 최신값으로 덮어쓰거나 Provider 간 유사성만으로 자동 병합하지 않는다.

공통 기여는 계정 소유 증명과 별개이며 회원 provenance를 공개하지 않는다. Provider와 획득 방식별 eligibility는 versioned policy로 fail closed하고, 큰 충돌은 기존 Profile을 유지한 채 검토 대상으로 남긴다. Search는 Canonical Place ID별 파생 projection이며 append-only catalog change로 재생할 수 있어야 한다. 기존 개인 별칭의 provenance를 복원할 수 없는 역사 데이터는 자동 승격하지 않고, 허용된 재검증이나 명시적 legacy 승인 없이는 개인 fallback으로 유지한다.
