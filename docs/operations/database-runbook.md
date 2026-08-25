# Database runbook

ADR 0004 records that the Infra PostGIS gate was unavailable and selects the Place-owned physical
runtime. `deploy/database-runtime.json` and `deploy/compose.database.yml` are source-only inputs; they
do not authorize production startup or application connection.

Before activation, provision every distinct secret file named by `deploy/database-runtime.json`, then
run `npm run database:prepare --workspace @place/backend` from an operator boundary that can read
those files. The command verifies it is connected to database `place` under `place_admin`, refuses to
adopt unmarked migration/runtime roles, installs PostGIS and `pg_trgm` under administrator ownership, and runs
ordered migrations under `place_owner`. It is idempotent but is never an HTTP/Worker startup hook.

Inject `PLACE_DATABASE_TEST_HOST`, then run `npm run test:database` to reproduce the disposable
PostGIS contract test. It proves a repeated preparation succeeds, `place_app` can use intended DML,
cannot perform DDL, alter table ownership, or modify migration metadata, and the spatial query plan uses
`canonical_places_location_gist`. 로컬 검색 suite는 대표 데이터에서 text `gin_trgm_ops`,
geometry GiST, taxonomy array GIN plan과 회원 격리도 검증한다. The same test exercises access bootstrap/resolution, last-owner
protection, stale-write conflict, malformed-ID non-disclosure, and role-change/audit rollback through
the module interface. It also proves two Web pools share encrypted browser-auth state, consume a login
transaction once, restore/logout a session across instances, and cannot update session rows directly.
The repository now provides a disposable database-level recovery proof:

```powershell
$env:PLACE_DATABASE_TEST_HOST='<test-owned-host>'
npm run test:database-recovery
```

The command emits one `place-database-recovery-evidence.v1` document only after rotated credentials,
isolated database contents, PostGIS/index/data restoration, runtime DDL denial, encrypted dump
contents, and protected-key session recovery pass. It always removes its two containers and temporary
files. Before activation, operators still define encrypted off-host storage, retention, restore
frequency, ownership, alerting, and an environment-specific recovery record. Never run DDL from the
runtime process.
