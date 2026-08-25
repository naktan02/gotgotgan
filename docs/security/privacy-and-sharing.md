# Privacy and sharing

Private is the default for personal library data, visits, ratings, notes, entries, imports, and
provider connections. Public and explicitly shared projections enumerate allowed fields rather than
filtering a private record after serialization. Authorization-denial tests cover every new projection.

Stage 4 public Collection projection에는 publication ID, visibility, 이름, 설명, 정렬된 Place
ID, 갱신 시각만 포함한다. public Writing projection에는 publication ID, visibility, 글 종류,
공개 본문, 연결한 Place ID, 갱신 시각만 포함한다. 이 query는 owner membership, 저장·가고
싶음 preference, Personal Rating과 이력, Tag, Visit, 복사 provenance, Writing revision을
선택하지 않는다. Web도 동일한 허용 목록을 검증하고 예상하지 않은 Backend field를 거부한다.

Stage 5 익명 검색은 공개 Place projection만 반환한다. 저장·가고 싶음·방문·Personal Rating
filter는 verified membership과 `search.read` 권한이 있을 때만 실행하며 membership ID를 browser
입력으로 받지 않는다. 회원별 signal은 Search 소유 별도 table에서 membership으로 격리하고,
다른 회원의 값이나 identifier가 결과·오류·cursor에 노출되지 않는지 실제 PostGIS로 검증한다.
