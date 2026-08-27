import type { MigrationBuilder } from 'node-pg-migrate'

export function up(pgm: MigrationBuilder): void {
  pgm.sql(`
    ALTER TABLE library.collection_places
      DROP CONSTRAINT collection_places_collection_id_position_key,
      ADD CONSTRAINT collection_places_position_unique
        UNIQUE (collection_id, position) DEFERRABLE INITIALLY IMMEDIATE;

    CREATE INDEX library_place_tags_member_tag_place
      ON library.place_tags (membership_id, tag_id, canonical_place_id);

    GRANT DELETE ON TABLE
      library.collections,
      library.tags,
      library.collection_copy_provenance,
      library.collection_import_provenance,
      library.collection_place_import_provenance
    TO place_app;
  `)
}

export function down(pgm: MigrationBuilder): void {
  pgm.sql(`
    REVOKE DELETE ON TABLE
      library.collections,
      library.tags,
      library.collection_copy_provenance,
      library.collection_import_provenance,
      library.collection_place_import_provenance
    FROM place_app;

    DROP INDEX library.library_place_tags_member_tag_place;

    ALTER TABLE library.collection_places
      DROP CONSTRAINT collection_places_position_unique,
      ADD CONSTRAINT collection_places_collection_id_position_key
        UNIQUE (collection_id, position);
  `)
}
