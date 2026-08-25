# Process entrypoints

Entrypoints compose module interfaces with adapters and own start, readiness, drain, and close. They
contain no business decisions. `http` and `worker` are separately deployable processes from the same
compiled backend package. `cli` owns explicit operator process exit/output behavior; its database
preparation entrypoint invokes the platform lifecycle module and is never an application startup hook.

The HTTP entrypoint requires an explicit `source-only` or `production` mode. Source-only mode exposes
only lifecycle routes. Production mode delegates protected configuration, bounded PostgreSQL/OIDC
composition, readiness, and idempotent close to `production-runtime.ts`; it does not choose policy or
credentials itself.
