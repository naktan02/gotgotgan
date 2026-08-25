# Internal worker v1

The future HTTP process submits a durable command containing opaque references, operation type,
requester authorization snapshot reference, idempotency key, and bounded parameters. It does not
send browser cookies, provider passwords, or raw profile paths.

The worker claims through a lease, records attempts and heartbeats, and writes results through
Place-owned module interfaces. Stage 1 has no job schema or claim implementation.

Stage 3 adds the in-process ingestion and canonical-resolution interfaces only. It does not publish a
worker job schema or register a claimant. A later durable job contract will carry opaque record and
decision references rather than provider payloads, browser state, or module implementation types.
