# PostgreSQL writing adapter

The adapter atomically applies optimistic document commands, replaces owned Place links, records a
private revision, and stores an idempotency receipt. Publication lookup uses an allowlisted query
that cannot select owner or revision-history fields.
