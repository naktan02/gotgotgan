# Canonical resolution PostgreSQL adapter

`PostgresCanonicalResolutionStore` applies each command in one transaction. Sorted resource advisory
locks serialize competing decisions for the same Canonical Place or provider identity without
granting update authority on the append-only decision ledger.

Merge changes the source to a redirect, moves its provider links, and appends redirect plus lineage
history. Split creates a new Canonical Place, moves only the selected provider identity, and appends
lineage while leaving the source reference active. Retirement creates a tombstone-like terminal
reference. No operation deletes canonical identity or history.
