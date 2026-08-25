# Database runbook

ADR 0004 records that the Infra PostGIS gate was unavailable and selects the Place-owned physical
runtime. `deploy/database-runtime.json` and `deploy/compose.database.yml` are source-only inputs; they
do not authorize production startup or application connection.

Before activation, provision distinct administrator, migration, and runtime secret files; create the
migration/runtime roles with least privilege; run Place-owned migrations as `place_owner`; prove
`place_app` cannot perform DDL, alter ownership, or modify migration metadata; verify PostGIS and the
expected spatial index; perform a database-level backup and isolated restore; then record upgrade and
rollback evidence. Never run DDL from the runtime process.
