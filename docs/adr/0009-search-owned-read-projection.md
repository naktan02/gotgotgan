# 0009: 검색 전용 Read Projection이 모듈 간 조회를 대신한다

- 상태: accepted
- 날짜: 2026-08-26

## 배경

로컬 검색은 Canonical Place, Taxonomy, Library, Visits가 소유하는 사실을 함께 필터링해야
한다. Search adapter가 각 schema를 직접 join하면 새 검색 조건 하나가 여러 owner의 table
구조에 결합되고, 모듈별 변경이 검색 구현과 배포를 연쇄 수정하게 된다. 반대로 모든 검색을
각 owner에 동기 호출하면 cursor 순서, 부분 실패, query plan을 한 인터페이스에서 보장하기
어렵다.

## 결정

`search` 모듈이 `Local Search Projection`을 소유한다. 각 owner의 composition/event adapter는
공개된 projection command로 검색에 필요한 최소 사실과 source version만 전달한다. 검색은
자신의 `search` schema만 조회하며 Canonical Place나 개인 콘텐츠의 원본을 변경하지 않는다.

공개 place document와 membership별 개인 signal을 별도 table로 둔다. 익명 검색은 공개
document만 projection하고, 개인 필터는 검증된 membership ID가 있을 때만 signal을 결합한다.
오래된 source version은 현재 projection을 덮어쓰지 않는다.

## 결과

- `places`, `taxonomy`, `library`, `visits`는 계속 각 원본과 규칙의 단일 owner다.
- 검색 schema는 의도적으로 중복된 read model이며 지연 가능성이 계약에 포함된다.
- 새 owner 사실을 검색에 추가하려면 그 owner의 versioned projection handoff가 필요하다.
- 재구축, 지연, 누락을 운영 상태로 관찰해야 하며 검색 projection은 canonical 증거가 아니다.
- 미래 provider 검색 cursor나 내부 token은 브라우저 cursor에 그대로 포함할 수 없다.

## 재검토 조건

검색이 독립 배포·용량·복구 수명주기를 요구하면 같은 공개 projection 인터페이스를 유지한
채 별도 process 또는 database로 이동한다. 원본 owner table을 직접 조회하는 방식으로
되돌리지는 않는다.
