# Ingestion and resolution

현재 회원 가져오기는 Provider별 목록 제목·ID 조회 → 각 목록의 최소 장소 조회 → snapshot 검토·승인
→ 개인 Collection 저장이다. 메뉴 등 확장 상세는 별도 상태·Job이며 저장 완료 조건에 포함하지 않는다.
V3 Transfer 경로는 승인된 snapshot item을 고정해 재시도한다. 아래 legacy ImportBatch의 `enriching`
용어를 “상세 수집 완료까지 개인 저장을 기다림”으로 해석하지 않는다.

An import run moves through durable discovery, capture, normalization, matching, preview, review,
apply, and completion states. Raw evidence is immutable for its retention window and references a
parser version and checksum. Reprocessing creates a new normalized result without rewriting history.

Automatic merge requires an explicit confidence policy backed by measured evaluation data; ambiguous
matches enter review. Provider adapters gather evidence, Ingestion owns provider-neutral acquisition,
workflow, observations, candidates, and accepted Resolution Decisions, while Resolution owns
cross-provider comparison representations and Match Assessments. Places alone owns canonical identity.

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
transaction에 기록한다. 공동 Materialization Job은 먼저 Places 공개 interface로 Provider Identity를
조회한다. 이미 연결됐다면 각 Import 증거와 정책 link decision을 기록하고, 연결되지 않았다면 가져온
Source Snapshot을 근거로 한 번 create/link한다. 이후 요청 회원의 private Collection에 외부 상세
호출 없이 멱등 저장한다.

같은 `(provider key, provider place ID)`의 여러 intent는 job 하나를 공유한다. Provider 상세 상태는
`pending`, 정규화된 Source Observation을 참조하는 `available`, 또는 재시도하지 않는 `unavailable`이며
개인 저장 상태와 독립적이다. 별도 Provider Place Detail Job은 `pending` identity만 lease/fencing으로
claim하고, 회원 ID·ImportBatch·브라우저 profile 없이 Provider-neutral Detail Source를 호출한다. 성공 시
immutable Observation과 Candidate를 먼저 기록하고 그 뒤에만 `available`로 전환한다. retryable 실패는
다시 예약하고, 지원하지 않음·찾을 수 없음·영구적인 schema 불일치는 `unavailable`로 남긴다. 어떤 결과도
Canonical Place를 직접 변경하지 않는다. Provider Identity가 없거나 snapshot을 안전하게 연결할 수 없을
때만 개인 item을 `needs-review`로 전환한다.

## Stage 8A cross-provider identity assessment

Resolution indexes the latest Source Observation for each Provider Place Identity as a replaceable
Place Evidence Representation. The representation keeps every raw multilingual name and language tag
beside deterministic comparison forms. It is an index over evidence, not a new observation, alias, or
canonical record. An older observation cannot replace a newer representation; an exact replay returns
the previous result and conflicting identity reuse fails.

Candidate blocking is bounded and combines PostGIS distance, `pg_trgm` name/address similarity, exact
phone comparison keys, and website hosts. Comparison preserves independent distance, name, address,
phone, website, category, explicit branch/floor, and observation-time features. Disjoint writing
scripts produce unknown name similarity rather than false difference. Same-building but different
explicit floor or branch and far-apart concurrent observations are strong negative evidence.

Every comparison appends a policy-versioned Match Assessment with feature values, reasons, confidence,
and one of `likely-same`, `needs-review`, or `likely-different`. These values route future clustering,
verification, and evaluation only. They are not Resolution Decisions and cannot link, merge, split,
retire, or otherwise mutate Canonical Places.

Stage 8B adds immutable versioned Place Cluster Proposals, normalized member rows, and explicit links
to supporting Match Assessments. The Excel-like Provider matrix is a dynamic read projection, not a
table with fixed Provider columns. Variable Provider payloads stay in Source Observations and
policy-versioned feature snapshots stay in Match Assessments; stable identities and relationships are
normalized without guessing unobserved detail fields.

Real accuracy evaluation waits for at least two actual connected-account Provider observation streams.
A future web-research verifier operates once per changed cluster proposal, stores append-only structured
Cluster Verifications and cited public sources, and receives no member or browser-session data. Human
work is limited to conflicts and risk-stratified audits. Automatic link/merge remains disabled until
measured cluster precision, false-merge cost, and recovery gates are explicitly accepted.
