# 0005: node-pg-migrate behind an operator-owned database lifecycle command

Status: accepted

Date: 2026-08-25

## Context

Stage 3 requires transactional, ordered PostgreSQL/PostGIS migrations without making an ORM model the
schema authority. Direct SQL scripts preserve PostGIS expressiveness but would require Place to build
and maintain migration history, ordering, locking, and TypeScript loading. Application startup cannot
hold migration authority, while deployment still needs one repeatable preparation interface.

## Decision

Place pins `node-pg-migrate` and `pg` in the backend package. The public operator interface is
`database:prepare`: one deep platform module reads the repository-owned runtime contract and protected
secret files, provisions marked least-privilege roles and administrator-owned PostGIS, then hands the
connected migration-role client to ordered TypeScript migrations. HTTP and Worker entrypoints do not
import this module, receive its elevated credentials, or run DDL.

## Consequences

Migration SQL remains explicit and PostGIS-capable while file order, history, transaction, and
advisory-lock behavior come from a maintained tool. Role provisioning and schema migration share one
operator command but retain separate live database authorities. Domain persistence adapters remain
inside their owning modules; the lifecycle command is not a global repository or facade over them.

## Supersession condition

Reconsider only if the selected runner cannot safely express a proved migration/rollback need, loses
supported Node/PostgreSQL compatibility, or measured operational evidence requires independently
scheduled role provisioning and schema migration interfaces.
