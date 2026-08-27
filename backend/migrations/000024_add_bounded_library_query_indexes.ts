import type { MigrationBuilder } from 'node-pg-migrate'

export function up(pgm: MigrationBuilder): void {
  pgm.sql(`
    CREATE INDEX library_place_preferences_saved_updated
      ON library.place_preferences (membership_id, updated_at DESC, canonical_place_id)
      WHERE saved;
    CREATE INDEX library_place_preferences_wanted_updated
      ON library.place_preferences (membership_id, updated_at DESC, canonical_place_id)
      WHERE wanted;
    CREATE INDEX library_place_preferences_rated_updated
      ON library.place_preferences (membership_id, updated_at DESC, canonical_place_id)
      WHERE personal_rating IS NOT NULL;

    DROP INDEX library.collections_owner_updated;
    CREATE INDEX collections_owner_updated
      ON library.collections (owner_membership_id, updated_at DESC, id);
  `)
}

export function down(pgm: MigrationBuilder): void {
  pgm.sql(`
    DROP INDEX library.library_place_preferences_saved_updated;
    DROP INDEX library.library_place_preferences_wanted_updated;
    DROP INDEX library.library_place_preferences_rated_updated;

    DROP INDEX library.collections_owner_updated;
    CREATE INDEX collections_owner_updated
      ON library.collections (owner_membership_id, updated_at DESC);
  `)
}
