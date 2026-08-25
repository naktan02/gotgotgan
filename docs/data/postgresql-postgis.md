# PostgreSQL and PostGIS

The shared Platform PostgreSQL gate was unavailable at Stage 3, so ADR 0004 selects a Place-owned
physical PostGIS runtime. The source-only declaration pins one `linux/amd64` image digest and exposes
no host database port. The `place` database requires administrator-owned `postgis` and `pg_trgm` and
uses its own private network, data volume, role secrets, backup, restore, upgrade, and rollback lifecycle.

An isolated digest smoke and disposable integration suite prove PostgreSQL 17.11/PostGIS 3.5.7,
separate roles, migrations, runtime-role denial, spatial-index use, and the source-only HTTP Pool
composition. A separate two-runtime rehearsal proves database backup, isolated restore, credential
rotation, spatial-index restoration, and matching browser-session key recovery. This is source
evidence, not an active deployment claim. Activation still requires operational retention/off-host
backup evidence, published immutable artifacts, deployment rollback, and environment promotion. A future
shared-runtime move must not change Place schema or domain interfaces.

Stage 5 검색은 `search.place_documents`의 `gin_trgm_ops`, geometry GiST, Taxonomy array GIN을
사용한다. 대표 5,000행 fixture의 `EXPLAIN (FORMAT JSON)`이 세 index를 각각 선택하는지
blocking integration test로 확인한다. 회원 signal은 `(membership_id, place_id)`에 격리되며
익명 query에는 join 결과를 반환하지 않는다.
