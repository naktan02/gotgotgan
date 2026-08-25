# Internal worker v1

The future HTTP process submits a durable command containing opaque references, operation type,
requester authorization snapshot reference, idempotency key, and bounded parameters. It does not
send browser cookies, provider passwords, or raw profile paths.

The worker claims through a lease, records attempts and heartbeats, and writes results through
Place-owned module interfaces. Stage 1 has no job schema or claim implementation.
