# Backend migrations

This directory owns ordered TypeScript schema migrations executed only by the database preparation
operator command as `place_owner`. Filenames use a zero-padded monotonic prefix. Never edit an
applied migration; append a new file and keep every schema, grant, index, and rollback explicit.

Migrations define storage shared by module-owned persistence adapters. They are not repositories and
must not import business modules or another project.

`000003` adds Web-owned browser OIDC transaction and session persistence. It stores only encrypted
payloads plus authenticated metadata and grants the runtime role select/insert/delete rather than
schema or arbitrary update authority.
