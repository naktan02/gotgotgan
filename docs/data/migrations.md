# Migrations

ADR 0005 selects pinned `node-pg-migrate` with TypeScript migration files under
`backend/migrations/`. `npm run database:prepare --workspace @place/backend` is the single operator
interface. It reads administrator, migration, and runtime credentials from deployment-owned secret
files named by `deploy/database-runtime.json`; verifies the target database and authority; provisions
marked least-privilege login roles; creates administrator-owned PostGIS; and then runs pending
migrations as `place_owner`.

Migration history lives in `place_migrations.applied_migrations`. The runner checks file order, uses
one transaction for the pending batch, and fails rather than waiting when another runner owns the
advisory lock. Never edit an applied migration: append the next zero-padded migration and provide an
explicit `down` action when rollback can preserve the contract safely. SQL that cannot be
transactional must justify `noTransaction` and a separate recovery procedure before merge.

The first migration owns `places.canonical_places`, keeps location nullable for physical and
service-area identities, and adds a partial GiST index for located records. Runtime DML grants are
explicit. Application startup never receives administrator/migration credentials and never performs
DDL.
