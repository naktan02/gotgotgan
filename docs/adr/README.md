# Architecture decision records

ADRs record durable repository-local decisions. Copy `template.md`, assign the next number, state the
status and date, link evidence, name consequences and supersession conditions, and update routed docs.

현재 최신 결정은 [`0016-conservative-shadow-cluster-proposals.md`](0016-conservative-shadow-cluster-proposals.md)이며,
cross-provider 군집이 불완전한 전이 연결로 합쳐지지 않도록 모든 구성원 쌍의 근거를 요구한다.

Stage 7 결정은 `0011-connected-import-pipeline-and-provider-isolation.md`에 기록한다. 연결 계정
작업, Provider parser 격리, 암호화 캡처, 명시적 검토와 Library 반영 경계를 정의한다.
회원 PC의 session 경계와 다중 브라우저·다중 Provider 확장 구조는
`0012-cross-browser-member-connector.md`에 기록한다.

- `0001-typescript-web-server-worker.md`: selected runtime and process shape.
- `0002-logical-postgis-with-physical-fallback.md`: conditional database topology.
- `0003-place-access-and-identity-evidence.md`: verified external principals and Place-owned authority.
- `0004-place-owned-physical-postgis-runtime.md`: Stage 3 physical fallback after the shared PostGIS gate failed.
- `0005-node-pg-migrate-lifecycle.md`: operator-owned TypeScript migrations and role provisioning.
- `0006-encrypted-browser-auth-persistence.md`: multi-instance OIDC transaction/session storage and
  Web-owned pool lifecycle.
- `0007-jit-membership-and-independent-member-axes.md`: consent-gated just-in-time membership plus
  independent authority-role, user-grade, and product-tier axes.
- `0008-separate-evidence-decisions-from-canonical-mutations.md`: immutable ingestion decisions feed
  separately idempotent canonical mutations without cross-module source dependencies.
- `0009-search-owned-read-projection.md`: Search가 다른 owner schema를 join하지 않고 versioned
  Local Search Projection을 소유한다.
- `0010-interactive-discovery-and-canonical-promotion.md`: 입력 중 후보·Discovery impression·명시적
  관측·증거 기반 Canonical 승격의 수명주기를 분리한다.
- `0011-connected-import-pipeline-and-provider-isolation.md`: 연결 계정 Import 상태기계, Provider parser,
  암호화 capture, 검토와 Library 이행을 분리한다.
- `0012-cross-browser-member-connector.md`: 기존 browser session을 사용하는 하나의 다중 Provider
  Connector와 browser/provider/upload Adapter 경계를 정의한다.
- `0013-project-signed-platform-owner.md`: Identity의 서명된 단일 Platform Owner를 Place의 유일한
  Owner로 투영하는 경계를 정의한다.
- `0014-imported-snapshot-first-personal-save.md`: 안정된 Provider Place Identity의 Source Snapshot을
  즉시 개인 Library에 저장하고 Provider 상세 상태와 후속 Job을 분리한다.
- `0015-review-first-cross-provider-place-resolution.md`: Resolution 소유 증거 representation과 불변
  Match Assessment를 도입하고 측정 전 자동 link/merge를 금지한다.
- `0016-conservative-shadow-cluster-proposals.md`: immutable normalized shadow proposal을 저장하고
  connected-component 전이 병합 대신 모든 구성원 쌍의 `likely-same` 근거를 요구한다.
