# Ingestion module

Ingestion owns provider-neutral source observations, normalized Place candidates, and resolution
decisions. Its public interface records immutable facts with a caller-supplied stable identity and
returns `recorded` or `replayed`; reuse of that identity for different content is a conflict.

Candidate decisions cover review, not-the-same, create, and link. Canonical-conflict decisions cover
merge, split, and retirement without inventing a candidate. All retain evidence and actor/policy
references.

이 모듈은 Canonical Place를 직접 변경하지 않는다. Stage 6.5의 interactive materialization use case는
SourceObservation, PlaceCandidate, ResolutionDecision을 순서대로 기록한 뒤 consumer-owned
`CanonicalPlaceMaterializationPort`를 호출한다. production composition만 이 port를 Places 공개
interface에 연결한다. 선택 후 재시도는 최초 acquired time과 ID를 재사용하며, 이미 자신의 proposed
Place에 연결된 create 판정은 다른 link 판정으로 바꾸지 않는다. Provider-specific
payloads, Crawlee requests, Playwright pages, selectors, cookies, and browser profiles never cross
this module interface.

```text
domain/model
  <- application recording use cases and IngestionStore port
  <- PostgreSQL persistence adapter
  <- future worker/HTTP composition
```

The PostgreSQL adapter inserts into append-only `ingestion` tables. The runtime role has no update or
delete authority over evidence, candidates, or decisions.

## Stage 7 연결 계정 가져오기

Ingestion은 연결 메타데이터, ImportBatch/ImportItem, lease·fencing 작업, 캡처 메타데이터와 검토
receipt를 소유한다. HTTP 요청은 작업만 큐에 넣고 Worker가 별도 프로세스로 실행한다. Provider
비밀번호·cookie·MFA seed·실제 profile 경로는 저장하지 않고 배포가 해석하는 불투명 참조만 사용한다.

수집 결과는 preview다. create/link/skip 명시 검토가 immutable observation, candidate, reviewer
decision을 기록한 후 Places와 Library의 consumer port를 호출한다. 동일 command는 receipt로
재생되고 다른 command가 같은 item을 처리하려 하면 충돌한다.
