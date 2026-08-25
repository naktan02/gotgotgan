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

Library, Visits, and Writing are separate owners. Library does not store visited state, Visits does
not store ratings or writing, and Writing links only Canonical Place IDs. Their transports depend on
a platform-level product-authorization result; the entrypoint adapts verified Access membership and
permissions without allowing a product module to import Access source.
