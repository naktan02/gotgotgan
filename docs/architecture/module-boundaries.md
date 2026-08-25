# Module boundaries

Backend business capabilities live at `backend/src/modules/<module>`. Each module may contain
`domain`, `application`, `adapters`, `transport`, and `tests`; it creates only leaves it uses.

The module interface is the caller and test surface. Domain rules remain framework-free.
Persistence stays at `<module>/adapters/persistence`, not a global repository bucket. Provider-specific
HTTP, structured-web, browser, parser, and outbound-sync adapters stay under the providers module.

Entrypoints compose modules and own processes. They do not decide canonical identity, authorization,
retry policy, or merge outcomes.

`access` owns principal-to-membership resolution and Place authorization. `administration` may call
its public interface for management workflows but must not recreate role, tier, grant, bootstrap, or
last-owner rules. Business modules never import another module's internal files; composition injects
public interfaces at entrypoints.

`ingestion` owns immutable observations, candidates, and evidence-backed decisions. `places` owns
canonical identity changes and reference resolution. Their handoff is deliberately two-step and
idempotent: composition translates a recorded decision into a canonical command. This avoids direct
module imports and permits retry/review without treating provider evidence as an overwrite command.

Library, Visits, Writing은 서로 다른 owner다. Library는 visited 상태를 저장하지 않고,
Visits는 Rating이나 Writing을 저장하지 않으며, Writing은 Canonical Place ID만 연결한다.
각 transport는 platform 수준 product-authorization 결과에 의존한다. entrypoint는 제품
모듈이 Access source를 import하지 않도록 검증된 Access membership과 permission을 변환한다.

Taxonomy는 Node version을, Search는 Local Search Projection과 source 조정을 각각 소유한다.
Search adapter는 Places/Taxonomy/Library/Visits schema를 직접 조회하지 않는다. 각 owner가
공개 projection command 또는 미래 event adapter를 통해 최소 검색 사실과 source version을
전달한다. 이 중복 read model은 검색을 위한 것이며 canonical truth가 아니다.
