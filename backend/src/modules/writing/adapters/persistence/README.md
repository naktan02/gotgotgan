# PostgreSQL Writing adapter

optimistic document command 적용, 소유한 Place link 교체, private revision 기록, idempotency
receipt 저장을 하나의 transaction으로 처리한다. 공개 조회는 owner와 revision-history
field를 선택할 수 없는 허용 목록 query를 사용한다.
