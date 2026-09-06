import type { MigrationBuilder } from 'node-pg-migrate'

export function up(pgm: MigrationBuilder): void {
  pgm.sql(`
    ALTER TABLE transfers.web_import_acquisitions
      DROP CONSTRAINT web_import_acquisitions_provider_key_check,
      ADD CONSTRAINT web_import_acquisitions_provider_key_check
        CHECK (provider_key IN ('naver', 'google', 'kakao'));
  `)
}

export function down(pgm: MigrationBuilder): void {
  // PostgreSQL validates existing rows before narrowing. A non-NAVER row must
  // block rollback, never be deleted or relabelled as a different provider.
  pgm.sql(`
    ALTER TABLE transfers.web_import_acquisitions
      DROP CONSTRAINT web_import_acquisitions_provider_key_check,
      ADD CONSTRAINT web_import_acquisitions_provider_key_check
        CHECK (provider_key = 'naver');
  `)
}
