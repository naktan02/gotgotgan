# Ownership and isolation

Place authoritatively mutates only its own `place` database in the Place-owned physical PostGIS
runtime selected by ADR 0004. Administrator, migration owner, and non-DDL runtime roles are distinct;
their secret references are deployment-owned. No process queries another product database, and no
browser receives database or workload credentials.

Place database 안에서 Library, Visits, Writing은 서로 다른 schema와 adapter를 소유한다. 각
모듈은 다른 모듈의 schema를 조회하거나 변경하지 않는다. 세 모듈은 upstream identity인
Access membership ID와 Canonical Place ID를 참조할 수 있지만, 해당 foreign key가 mutation
ownership을 이전하지는 않는다.

Search는 `search` schema의 비정규화 read projection만 소유한다. Canonical Place, Taxonomy,
Library, Visits의 adapter나 table을 import/join하지 않고 각 owner가 공개한 versioned projection
command를 composition/event adapter가 호출한다. 공개 문서와 membership별 개인 signal은 별도
table이며, 익명 query는 개인 signal을 선택하지 않는다. projection은 재생성 가능한 파생
데이터이고 원본 증거나 다른 모듈의 mutation authority가 아니다.
