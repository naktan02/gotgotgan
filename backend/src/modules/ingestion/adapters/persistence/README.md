# Ingestion PostgreSQL adapter

`PostgresIngestionStore` implements the module's one append interface. It maps each record kind to
its owning table, stores the application-computed fingerprint, and compares that fingerprint after
an ID collision to distinguish an identical replay from a conflict.

The adapter stores normalized JSON facts, opaque capture references, and WGS84 candidate locations.
It never stores browser profile paths, provider credentials, or a raw provider object as canonical
Place data.
