# Ownership and isolation

Place authoritatively mutates only its own `place` database in the Place-owned physical PostGIS
runtime selected by ADR 0004. Administrator, migration owner, and non-DDL runtime roles are distinct;
their secret references are deployment-owned. No process queries another product database, and no
browser receives database or workload credentials.
