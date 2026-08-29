import type { MigrationBuilder } from 'node-pg-migrate'

export function up(pgm: MigrationBuilder): void {
  pgm.sql(`
    CREATE INDEX writing_document_place_links_place_document
      ON writing.document_place_links (canonical_place_id, document_id);
  `)
}

export function down(pgm: MigrationBuilder): void {
  pgm.sql(`
    DROP INDEX writing.writing_document_place_links_place_document;
  `)
}
