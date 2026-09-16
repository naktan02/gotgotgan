# Database lifecycle platform

This module hides Place database contract parsing, protected secret-file reads, least-privilege role
provisioning, PostGIS ownership, migration locking, and connection cleanup behind one
`prepareDatabase` interface. It returns an audit-safe result and never exposes connection details.
Explicit owner-only maintenance uses `withDatabaseOwner` in the same module so it reuses protected
file parsing and connected-role validation without provisioning roles or running startup DDL.

Only the explicit CLI entrypoint may invoke it. HTTP, Worker, business modules, and browsers never
receive administrator or migration credentials and never run DDL.
