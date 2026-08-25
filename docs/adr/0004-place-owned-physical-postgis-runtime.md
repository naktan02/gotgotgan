# 0004: Place-owned physical PostGIS runtime for Stage 3

Status: accepted

Date: 2026-08-25

## Context

ADR 0002 prefers a logical Place database in the shared Platform PostgreSQL runtime only after Infra
Runtime proves a PostGIS-capable image, an allow-listed per-database extension contract, privilege
separation, non-Place isolation, backup/restore, upgrade, and rollback. At Infra Runtime commit
`d150f4d`, the shared image is standard PostgreSQL, `product-database.v1` cannot declare extensions,
and the Compose topology has no Place data network or PostGIS rehearsal. Changing that physical
image would be a platform-wide upgrade affecting four existing product databases, not a bounded
Place onboarding change.

## Decision

Stage 3 uses a Place-owned physical PostgreSQL/PostGIS runtime. Place owns the runtime declaration,
database-level backup/restore evidence, schema, and migrations in this repository. The runtime is
`linux/amd64` and pins the platform-specific digest resolved from the official
`postgis/postgis:17-3.5-alpine` image. The database is `place`; administrator `place_admin`, migration
owner `place_owner`, and runtime `place_app` are distinct roles supplied through deployment-owned
secret files. Only `postgis` is required initially.

`deploy/database-runtime.json` is the machine-readable interface and
`deploy/compose.database.yml` is its source-only Compose implementation. Neither publishes a host
port nor activates an application connection. On 2026-08-25, an isolated disposable container from
the pinned digest reported PostgreSQL 17.11 and PostGIS 3.5.7 in the `place` database.

## Consequences

Place consumes more memory than a logical database but gains independent extension, upgrade,
failure, backup, restore, and rollback ownership. Existing Platform databases and Infra Runtime need
no change. HTTP and worker processes still belong to one Place product and may share the private
Place data network; a separate database process is infrastructure isolation, not a new business
service or repository.

Migration/runtime role provisioning, schema migrations, spatial-index tests, isolated restore, and
application composition remain required before this declaration becomes active. Runtime processes
never receive administrator or migration credentials and never run DDL.

## Supersession condition

Reconsider a shared logical database only after Infra Runtime publishes and rehearses a compatible
extension-aware manifest version, PostGIS image upgrade/rollback, non-Place isolation, and database-
level restore contract, and a measured comparison justifies migration. The Place schema and module
interfaces must remain unchanged by that topology move.
