# Architecture decision records

ADRs record durable repository-local decisions. Copy `template.md`, assign the next number, state the
status and date, link evidence, name consequences and supersession conditions, and update routed docs.

현재 최신 결정은
[`0022-publish-canonical-place-profiles-from-evidence.md`](0022-publish-canonical-place-profiles-from-evidence.md)이며,
Provider-neutral assertion 원장에서 근거가 명시된 Canonical Place Profile revision을 발행한다.

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
- `0017-retire-public-handles-without-reassignment.md`: Profile/Membership 삭제 뒤 Public Handle의
  Membership 연결은 제거하되 namespace 예약은 보존하고 다른 회원 재배정을 금지한다.
- `0018-separate-profile-reports-from-moderation.md`: 인증된 categorized 신고, reviewer 이상 운영 판정,
  180일 보존, owner visibility와 독립된 allowed/withheld 상태를 정의한다.
- `0019-bind-profile-appeals-to-withheld-decisions.md`: owner Notice와 structured appeal, reviewer의
  immutable resolution, accepted appeal과 allowed 복구의 원자성을 정의한다.
- `0020-separate-product-brand-from-place-service-identity.md`: 사용자 표시명 `곳곳간`과 저장소
  slug `gotgotgan`을 채택하고 호환성이 필요한 내부 `place` 식별자를 유지한다.
- `0021-make-collection-membership-the-favorite-truth.md`: 사용자 소유 Collection membership을
  즐겨찾기의 유일한 기준으로 삼고 Collection-first Interface와 v1 전환 게이트를 정의한다.
- `0022-publish-canonical-place-profiles-from-evidence.md`: 정규화 assertion 원장, 불변 Profile,
  Area·Taxonomy exact version과 fail-closed Media 권리를 하나의 발행 경계로 정의한다.
