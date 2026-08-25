# 0002: Logical PostGIS database with physical fallback

Status: accepted with implementation gate

Date: 2026-08-25

## Context

The mini-PC platform already shares one physical PostgreSQL runtime across isolated logical databases,
but that runtime does not yet declare or package PostGIS.

## Decision

Prefer a Place logical database in the shared runtime only after Infra proves its PostGIS extension,
privilege, upgrade, backup, restore, and rollback contract. Otherwise deploy a Place-owned physical
PostGIS runtime without weakening spatial behavior.

## Consequences

The initial topology is resource-efficient and preserves a database-level extraction seam. Stage 3
is blocked on the Infra gate; manual shared-runtime modification is not an alternative.

Stage 3 evaluated this gate against Infra Runtime commit `d150f4d`; the gate was not available.
ADR 0004 activates the Place-owned physical fallback without changing this conditional policy.

## Supersession condition

Revisit after measured isolation, scaling, extension, or recovery requirements show a dedicated
physical owner is necessary.
