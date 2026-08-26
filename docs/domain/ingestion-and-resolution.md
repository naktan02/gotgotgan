# Ingestion and resolution

An import run moves through durable discovery, capture, normalization, matching, preview, review,
apply, and completion states. Raw evidence is immutable for its retention window and references a
parser version and checksum. Reprocessing creates a new normalized result without rewriting history.

Automatic merge requires an explicit confidence policy; ambiguous matches enter review. Provider
adapters gather evidence, while ingestion owns provider-neutral workflow and resolution orchestration.

The first Stage 3 seam records three immutable artifacts:

1. `Source Observation`: provider identity, acquisition kind, checksum, parser version, timestamps,
   normalized facts, confidence, and an optional opaque capture reference;
2. `Place Candidate`: one versioned normalized interpretation with optional WGS84 location; and
3. `Resolution Decision`: needs review, explicit not-the-same, create/link/merge/split/retire Place,
   with actor/policy reference, evidence IDs, rationale, and time. Candidate decisions name their
   candidate; canonical-conflict decisions need not invent one.

Recording a decision does not mutate canonical state. The `places` module separately accepts a
canonical command with the source decision reference. This keeps observation replay and reviewer
workflow independent from canonical lifecycle while preserving end-to-end traceability.

Stage 7 흐름은 `queued → running → partial/needs-user-action/needs-review → completed` 상태를
명시한다. 중간 page는 cursor로 재개되고 동일 `(batch, source item key)`는 다시 삽입되지 않는다.
불완전하거나 충돌한 preview item은 사용자의 create/link/skip 결정 전에는 Canonical Place나 Library를
바꾸지 않는다. 승인된 item만 evidence와 reviewer decision을 남기고 개인 Library에서 saved 상태를
보장한다. 안정된 Provider identity가 있는 정상 item에는 목록 가져오기 승인이 Library 저장 intent가 된다.

안정된 Provider Place Identity가 있는 item은 `enriching` 상태의 Fulfillment Intent와 함께 같은
transaction에 기록한다. 공동 Fulfillment Job은 먼저 Places 공개 interface로 Provider Identity를
조회한다. 이미 연결됐다면 외부 Provider를 호출하지 않고 각 Import 증거와 정책 link decision을
기록한 뒤 요청 회원의 Library에 저장한다. 연결되지 않았을 때만 서버 소유 상세 Adapter를 호출한다.

같은 `(provider key, provider place ID)`의 여러 intent는 job 하나를 공유한다. 상세 증거가 충분하면
한 번 create/link한 Canonical Place를 모든 대기 회원에게 멱등 저장한다. 정보가 불완전하거나 충돌하면
자동 Canonical 생성 대신 각 item을 `needs-review`로 전환한다. 최종 실패는 intent를 보존한 상태로
명시적인 실패가 되며, retryable 실패는 lease와 fencing을 유지한 채 다시 예약한다.
