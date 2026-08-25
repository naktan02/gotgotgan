# Migrations

Stage 3 selects a TypeScript migration tool after proving PostGIS SQL, transactional limits, extension
ownership, and rollback needs. Migrations are versioned repository artifacts run by the migration
role before the runtime starts. Application startup never performs DDL.
