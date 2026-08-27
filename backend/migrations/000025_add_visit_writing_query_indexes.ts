import type { MigrationBuilder } from 'node-pg-migrate'

export function up(pgm: MigrationBuilder): void {
  pgm.sql(`
    DROP INDEX visits.visit_occurrences_member_place_time;
    CREATE INDEX visit_occurrences_member_place_time
      ON visits.visit_occurrences (
        membership_id,
        canonical_place_id,
        visited_at DESC,
        id
      );

    DROP INDEX writing.writing_documents_owner_updated;
    CREATE INDEX writing_documents_owner_updated
      ON writing.documents (owner_membership_id, updated_at DESC, id);
  `)
}

export function down(pgm: MigrationBuilder): void {
  pgm.sql(`
    DROP INDEX visits.visit_occurrences_member_place_time;
    CREATE INDEX visit_occurrences_member_place_time
      ON visits.visit_occurrences (membership_id, canonical_place_id, visited_at DESC);

    DROP INDEX writing.writing_documents_owner_updated;
    CREATE INDEX writing_documents_owner_updated
      ON writing.documents (owner_membership_id, updated_at DESC);
  `)
}
