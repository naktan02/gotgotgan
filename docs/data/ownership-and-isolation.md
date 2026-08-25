# Ownership and isolation

Place authoritatively mutates only its own `place` database in the Place-owned physical PostGIS
runtime selected by ADR 0004. Administrator, migration owner, and non-DDL runtime roles are distinct;
their secret references are deployment-owned. No process queries another product database, and no
browser receives database or workload credentials.

Within the Place database, Library, Visits, and Writing own separate schemas and adapters. A module
does not query or mutate another module's schema. All three may reference Access membership IDs and
Canonical Place IDs as upstream identities; those foreign keys do not transfer mutation ownership.
