import type { MigrationBuilder } from 'node-pg-migrate'

export function up(pgm: MigrationBuilder): void {
  pgm.sql(`
    CREATE INDEX import_batches_member_state_created
      ON ingestion.import_batches (member_id, state, created_at DESC, id);

    CREATE INDEX import_items_batch_source_order
      ON ingestion.import_items (
        batch_id,
        source_list_position,
        source_position,
        id
      );
  `)
}

export function down(pgm: MigrationBuilder): void {
  pgm.sql(`
    DROP INDEX ingestion.import_items_batch_source_order;
    DROP INDEX ingestion.import_batches_member_state_created;
  `)
}
