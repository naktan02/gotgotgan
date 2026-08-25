# Backup and restore

The deployment operator owns physical backup storage, scheduling, retention, encryption, and access.
Place owns the database-level dump/restore contract and recovery verification.

`npm run test:database-recovery` starts independent source and restore PostGIS runtimes with separate
random credentials. It prepares and seeds only the Place database, creates an encrypted browser
session, takes a PostgreSQL custom-format database dump, restores it over a separately prepared
target, and verifies:

- the restored runtime accepts only the rotated target credential;
- the isolated target contains only the default administrative database and `place`;
- PostGIS, the spatial GiST index, canonical data, and runtime DML/DDL boundaries survive;
- raw database and role passwords, the encryption key, and plaintext browser tokens are absent from
  the dump; and
- the restored encrypted browser session resolves only when the matching protected key is supplied.

The dump remains sensitive because it contains Place data even though browser payloads are encrypted.
The rehearsal cleans both containers, secret files, and dump. It proves the source recovery path but
does not provide an operational retention schedule, off-host copy, or environment recovery record.
