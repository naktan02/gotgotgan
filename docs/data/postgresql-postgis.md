# PostgreSQL and PostGIS

The preferred mini-PC topology is a dedicated `place` logical database in the shared Platform
PostgreSQL physical runtime. This is conditional: Infra must first supply a digest-pinned
PostGIS-capable image, per-database allow-listed extension declaration, privilege separation, upgrade,
backup, isolated restore, and rollback evidence.

If that gate fails, Place uses a Place-owned physical PostGIS runtime. Spatial behavior is not
weakened and the shared server is not modified manually.
