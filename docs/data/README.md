# Data documentation

- `ownership-and-isolation.md`: database and role ownership.
- `postgresql-postgis.md`: preferred topology and Infra gate.
- `migrations.md`: schema-change lifecycle.
- `captures-and-retention.md`: raw evidence storage and deletion.
- `backup-and-restore.md`: recovery ownership and proof.

The source-only database declaration, preparation command, canonical Place migration, normalized
access migration, encrypted browser-auth migration, and corresponding persistence adapters exist. No
Place application process is connected to a provisioned database.
