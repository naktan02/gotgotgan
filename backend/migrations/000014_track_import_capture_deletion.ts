import type { MigrationBuilder } from 'node-pg-migrate'

export function up(pgm: MigrationBuilder): void {
  pgm.sql(`
    ALTER TABLE ingestion.import_capture_artifacts
      ADD COLUMN deleted_at timestamptz,
      ADD CONSTRAINT import_capture_deleted_after_retention
        CHECK (deleted_at IS NULL OR deleted_at >= retained_until);

    DROP INDEX ingestion.import_capture_retention;
    CREATE INDEX import_capture_retention
      ON ingestion.import_capture_artifacts (retained_until, id)
      WHERE deleted_at IS NULL;

    GRANT UPDATE (deleted_at)
      ON ingestion.import_capture_artifacts TO place_app;
  `)
}

export function down(pgm: MigrationBuilder): void {
  pgm.sql(`
    REVOKE UPDATE (deleted_at)
      ON ingestion.import_capture_artifacts FROM place_app;
    DROP INDEX ingestion.import_capture_retention;
    ALTER TABLE ingestion.import_capture_artifacts
      DROP CONSTRAINT import_capture_deleted_after_retention,
      DROP COLUMN deleted_at;
    CREATE INDEX import_capture_retention
      ON ingestion.import_capture_artifacts (retained_until, id);
  `)
}
