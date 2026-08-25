# PostgreSQL and PostGIS

The shared Platform PostgreSQL gate was unavailable at Stage 3, so ADR 0004 selects a Place-owned
physical PostGIS runtime. The source-only declaration pins one `linux/amd64` image digest and exposes
no host database port. The `place` database requires only `postgis` initially and uses its own private
network, data volume, role secrets, backup, restore, upgrade, and rollback lifecycle.

An isolated digest smoke proved PostgreSQL 17.11 and PostGIS 3.5.7. This is image evidence, not an
active deployment claim. Activation still requires separate roles, migrations, runtime-role denial,
spatial-index, backup, isolated restore, and rollback verification. A future shared-runtime move must
not change Place schema or domain interfaces.
