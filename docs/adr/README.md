# Architecture decision records

ADRs record durable repository-local decisions. Copy `template.md`, assign the next number, state the
status and date, link evidence, name consequences and supersession conditions, and update routed docs.

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
