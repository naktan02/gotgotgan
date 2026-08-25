# Database runbook

ADR 0004 records that the Infra PostGIS gate was unavailable and selects the Place-owned physical
runtime. `deploy/database-runtime.json` and `deploy/compose.database.yml` are source-only inputs; they
do not authorize production startup or application connection.

Before activation, provision every distinct secret file named by `deploy/database-runtime.json`, then
run `npm run database:prepare --workspace @place/backend` from an operator boundary that can read
those files. The command verifies it is connected to database `place` under `place_admin`, refuses to
adopt unmarked migration/runtime roles, installs PostGIS under administrator ownership, and runs
ordered migrations under `place_owner`. It is idempotent but is never an HTTP/Worker startup hook.

Inject `PLACE_DATABASE_TEST_HOST`, then run `npm run test:database` to reproduce the disposable
PostGIS contract test. It proves a repeated preparation succeeds, `place_app` can use intended DML,
cannot perform DDL, alter table ownership, or modify migration metadata, and the spatial query plan uses
`canonical_places_location_gist`. Before activation, still perform a database-level backup and
isolated restore and record upgrade/rollback evidence. Never run DDL from the runtime process.
