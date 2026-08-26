# Ingestion PostgreSQL Adapter

Ingestion의 application port는 그대로 유지하고 PostgreSQL 구현은 데이터 수명주기별 Adapter가
직접 소유한다.

- `PostgresConnectorImports`: Provider 연결, Connector grant/capture, capture 만료
- `PostgresImportQueue`: import 요청, acquisition queue와 lease
- `PostgresImportReview`: import 조회·취소·재개와 review receipt
- `PostgresImportedPlaceFulfillment`: Provider Place 단위 fulfillment queue와 lease
- `postgres-import-common.ts`: 여러 Adapter가 함께 사용하는 row mapping, batch 진행률 계산,
  replay-safe item 삽입
- `PostgresIngestionStore`: append-only observation·candidate·decision 기록

composition root는 필요한 Adapter를 port별로 직접 주입한다. 여러 책임을 다시 한 객체로 합치는
호환 façade는 두지 않는다. 각 Adapter는 자기 SQL, transaction, lease와 replay invariant를 소유하며
공통 구현 파일은 외부 module interface로 export하지 않는다.

Adapter는 정규화된 JSON 사실, 불투명한 capture reference, WGS84 후보 위치만 저장한다. 브라우저
profile 경로, Provider credential 또는 원시 Provider 객체를 canonical Place 데이터로 저장하지 않는다.
