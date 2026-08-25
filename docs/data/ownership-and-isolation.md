# Ownership and isolation

Place authoritatively mutates only its own logical database. The planned roles are a migration owner
and a non-DDL runtime role; their secret references are deployment-owned. No process queries another
product database, and no browser receives database or workload credentials.
