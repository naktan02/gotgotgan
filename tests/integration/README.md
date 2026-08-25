# Integration tests

The Stage 3 database test lives with the backend integration seam at
`backend/tests/integration/database-migrations.test.mjs` and runs through `npm run test:database`.
It owns a disposable PostGIS container and verifies preparation, roles, migration history, and the
spatial index. The same suite exercises the access persistence adapter through existing use cases,
including transactional audit failure. Backup and isolated restore remain to be added here as a
separate operator seam.
