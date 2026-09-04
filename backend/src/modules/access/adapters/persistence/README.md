# Access persistence adapters

This directory implements access-owned application ports without exporting SQL or database rows into
the domain. PostgreSQL receives a caller-owned pool; process composition remains responsible for pool
creation, readiness, drain, and close.

Membership, bootstrap, role-change, and audit behavior stay behind the access module interface. No
other module imports this directory directly.

`postgres-access-store.ts` remains the sole public adapter class. Its private
`postgres-access-store/` implementation is split by persistence change reason: membership row
projection/mapping, audit writes, membership creation transactions, authority-role mutation, and
platform-owner projection. These internal modules own their SQL and transaction invariants; they are
not re-exported and callers continue to use `PostgresAccessStore` through the access module index.
