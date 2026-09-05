# Worker entrypoint

이 폴더는 Backend artifact에서 독립 실행되는 Worker composition과 수명주기만 소유한다. Provider
parser, Ingestion use case, PostgreSQL adapter, encrypted file adapter의 내부 구현을 복제하지 않는다.

- `main.ts`: `--check`, bounded 1회 명령, 서비스별 연속 loop를 선택한다. 승인된 NAVER 공유 링크
  acquisition만 별도 worker에서 실행하며 remote-browser와 계정 전체 수집은 계속 fail closed한다.
- `config.ts`: DB URL과 capture keyring을 보호 파일에서 읽고 pool, 파일 크기, sweep batch를
  bounded 값으로 검증한다.
- `capture-sweep-runtime.ts`: Pool과 capture store를 만들고 만료 정리 use case를 실행한 뒤 항상
  자원을 닫는다.

Ingestion의 Fulfillment Worker는 Provider Identity별 공동 queue에서 Canonical cache를 먼저 확인하고
miss일 때만 상세 Adapter를 호출한다. 현재는 module interface와 Postgres Adapter·통합 검증까지만
있으며 실제 NAVER 서비스 profile을 조립하는 entrypoint 명령은 없다.

새 Provider별 selector, endpoint, login 동작은 이 폴더에 두지 않고 해당 Provider adapter leaf에
둔다. 둘 이상의 실제 browser adapter가 동일한 lifecycle 문제를 입증하기 전에는 공통 browser
runtime을 만들지 않는다.
