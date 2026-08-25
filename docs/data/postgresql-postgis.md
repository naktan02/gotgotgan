# PostgreSQL and PostGIS

The shared Platform PostgreSQL gate was unavailable at Stage 3, so ADR 0004 selects a Place-owned
physical PostGIS runtime. The source-only declaration pins one `linux/amd64` image digest and exposes
no host database port. The `place` database requires only `postgis` initially and uses its own private
network, data volume, role secrets, backup, restore, upgrade, and rollback lifecycle.

An isolated digest smoke and disposable integration suite prove PostgreSQL 17.11/PostGIS 3.5.7,
separate roles, migrations, runtime-role denial, spatial-index use, and the source-only HTTP Pool
composition. A separate two-runtime rehearsal proves database backup, isolated restore, credential
rotation, spatial-index restoration, and matching browser-session key recovery. This is source
evidence, not an active deployment claim. Activation still requires operational retention/off-host
backup evidence, published immutable artifacts, deployment rollback, and environment promotion. A future
shared-runtime move must not change Place schema or domain interfaces.
