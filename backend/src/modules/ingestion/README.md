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

회원 브라우저 Connector는 별도 acquisition job을 만들지 않는다. `createConnectorImportReceiver`가
grant 발급과 capture 제출 두 동작만 공개하고, 내부 `ConnectorImportStore`, `CaptureArtifactStore`,
`ConnectorCaptureParser`를 조립한다. DB는 `pending` receipt를 먼저 예약하고 암호화 파일 저장 뒤 같은
ImportBatch의 Item·Fulfillment intent·누적 receipt를 transaction으로 확정한다. Provider parser는
composition에서 공개 interface로 주입되므로 Ingestion이 Provider 내부 파일을 역참조하지 않는다.

불완전하거나 충돌한 수집 결과는 preview다. create/link/skip 명시 검토가 immutable observation,
candidate, reviewer decision을 기록한 후 Places와 Library의 consumer port를 호출한다. 동일 command는
receipt로 재생되고 다른 command가 같은 item을 처리하려 하면 충돌한다. 안정된 Provider identity가
있는 정상 item은 아래 Fulfillment 흐름으로 자동 처리한다.

보존 만료 정리는 `ImportCaptureRetentionStore`와 `CaptureArtifactReplayStore` 두 공개 port를 조립한
bounded use case다. DB adapter는 만료·미삭제 메타데이터와 삭제 표식만 소유하고, encrypted file
adapter는 opaque reference의 물리 파일만 소유한다. 한쪽이 다른 쪽 구현이나 경로를 알지 않으며
entrypoint가 수명주기를 조립한다.

안정된 Provider Place ID가 있는 ImportItem은 같은 transaction에서 `enriching` Intent와 연결된다.
Provider Identity별 Fulfillment Job은 먼저 `CanonicalPlaceMaterializationPort`로 기존 link를 확인한다.
hit이면 외부 상세 호출 없이 증거와 정책 link decision을 기록하고 Library에 저장한다. miss에서도
현재 snapshot 증거로 Canonical Place를 만들고 모든 대기 회원 Library에 fan-out한다. Provider 상세
수집은 별도 `ProviderPlaceDetailSource`와 `ProviderPlaceDetailJobStore` Interface를 사용한다. Worker는
지원 Adapter가 있는 Provider만 claim하고, 성공 시 immutable `provider-detail` Source Observation과
Place Candidate를 기록한 뒤 detail 상태만 `available`로 바꾼다. 이 단계는 Canonical Place를 수정하거나
동일 장소 판정을 내리지 않는다. Provider별 parsing과 TraceForge 연결은 Providers Adapter가 소유하고
Ingestion은 그 구현을 알지 않는다. 공개 상세 수집 중 보안 인증이 감지되면 자동 해제하지 않고
`provider-interaction-required`로 보류한다.

Migration `000043` 이후 상세 Job은 identity당 교체 가능한 한 행이 아니라 append-only 실행 이력이다.
freshness scheduler는 최신 성공/실패 시각이 cutoff보다 오래되고 active Job이 없는 identity만 bounded
batch로 새 Job에 넣는다. 성공한 관찰은 직전 정상 관찰과 checksum을 비교해 `initial`, `unchanged`,
`changed`를 기록한다. 갱신 실패는 기존 `available` projection을 유지하며
`provider-interaction-required`는 자동 재큐잉하지 않는다. 운영자 재개 명령/UI는 아직 구현되지 않았다.

새 SourceSnapshot의 안정된 Provider identity는 Canonical 매칭 여부와 무관하게 Ingestion 소유 DB 함수가
상세 상태를 확인한다. 이미 `available` 또는 `unavailable`이면 최초 상세 Job을 추가하지 않는다.
호출 모듈은 snapshot ID로 대상 identity를 고른 뒤 Provider key와 ID만 전달하고, 함수는 기존 terminal
상세 상태를 되돌리지 않으며 `pending` identity에 active append-only Job이 없을 때만 멱등 생성한다.

현재 제품 흐름은 목록 제목 조회 → 목록별 최소 장소 조회 → 승인 후 개인 Collection 저장이다.
메뉴 등 확장 상세는 저장 완료의 선행 조건이 아니다. 상세 실행 방식이 확정될 때까지 Provider detail
Worker와 freshness scheduler를 실행하지 않는다. 대기 Job 기록만 남기며 TraceForge 개발 코드는 바꾸지 않는다.

ImportItem은 Provider의 `source_list_id`, 목록 순서와 목록 안 순서를 함께 보존한다. Fulfillment와
명시적 review 모두 이 메타데이터를 Library 공개 port에 전달한다. Ingestion은 원본 폴더를 Taxonomy로
해석하거나 Library Collection을 직접 만들지 않는다.

회원용 Import read는 `ImportQueries` Interface 하나로 이력과 배치 상세만 공개한다. PostgreSQL
Adapter는 이력을 생성 시각 keyset으로, Item을 원본 목록·항목 순서 keyset으로 제한하며 cursor는
필터 또는 batch ID에 묶는다. 취소·재개는 `ImportManagementStore`, 명시적 판정은
`ImportReviewStore`가 각각 소유하므로 조회, lifecycle 변경, review transaction이 한 파일에 모이지
않는다. 이 경계는 Provider Adapter, AI 판정, Product Tier 분기를 추가하지 않고도 HTTP composition에서
인증·향후 entitlement 정책을 앞단에 붙일 수 있게 유지한다.
