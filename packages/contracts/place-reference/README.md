# Place reference contracts

`place-reference.v1.schema.json` is the first cross-service reference envelope. An available
reference contains the resolved opaque canonical Place ID. `unavailable` covers absent or retired
identities, while `redacted` deliberately hides whether a private reference exists. Consumers must
handle both without querying Place tables or inferring authorization from identifiers.
