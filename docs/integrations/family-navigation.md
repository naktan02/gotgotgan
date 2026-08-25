# Family navigation

Place consumes a visibility-projected `family-navigation.v1` through a frontend platform adapter.
Only an `active` manifest may contain destinations. Service IDs must be unique and destinations must
be credential-free public HTTPS URLs. Missing or invalid input fails closed to an empty state; source
contains no family-service list or endpoint.

The workspace-level composer owner is unresolved, so delivery remains `integration-gated`. Place is
responsible only for validation and rendering. Integration is blocked until ownership, authenticated
visibility projection, manifest publication, refresh/failure behavior, and tests are approved.
