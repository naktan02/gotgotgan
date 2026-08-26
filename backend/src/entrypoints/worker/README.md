# Worker entrypoint

이 폴더는 Backend artifact에서 독립 실행되는 Worker composition과 수명주기만 소유한다. Provider
parser, Ingestion use case, PostgreSQL adapter, encrypted file adapter의 내부 구현을 복제하지 않는다.

- `main.ts`: `--check`와 명시적 1회 유지보수 명령만 선택한다. 실제 Provider acquisition은 전용
  profile과 관찰 계약이 준비될 때까지 fail closed한다.
- `config.ts`: DB URL과 capture keyring을 보호 파일에서 읽고 pool, 파일 크기, sweep batch를
  bounded 값으로 검증한다.
- `capture-sweep-runtime.ts`: Pool과 capture store를 만들고 만료 정리 use case를 실행한 뒤 항상
  자원을 닫는다.

새 Provider별 selector, endpoint, login 동작은 이 폴더에 두지 않고 해당 Provider adapter leaf에
둔다. 둘 이상의 실제 browser adapter가 동일한 lifecycle 문제를 입증하기 전에는 공통 browser
runtime을 만들지 않는다.
