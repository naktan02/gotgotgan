import type { MigrationBuilder } from 'node-pg-migrate'

export function up(pgm: MigrationBuilder): void {
  pgm.sql(`
    ALTER TABLE ingestion.import_items
      ADD COLUMN source_list_id text,
      ADD COLUMN source_list_position integer,
      ADD COLUMN source_position integer;

    WITH positioned AS (
      SELECT id,
             'legacy-name:' || md5(list_name) AS source_list_id,
             row_number() OVER (
               PARTITION BY batch_id, list_name ORDER BY id
             )::integer - 1 AS source_position
      FROM ingestion.import_items
    )
    UPDATE ingestion.import_items AS imported
    SET source_list_id = positioned.source_list_id,
        source_list_position = 0,
        source_position = positioned.source_position
    FROM positioned
    WHERE imported.id = positioned.id;

    ALTER TABLE ingestion.import_items
      ALTER COLUMN source_list_id SET NOT NULL,
      ALTER COLUMN source_list_position SET NOT NULL,
      ALTER COLUMN source_position SET NOT NULL,
      ADD CONSTRAINT import_items_source_list_id_length
        CHECK (length(source_list_id) BETWEEN 1 AND 512),
      ADD CONSTRAINT import_items_source_position_nonnegative
        CHECK (source_position >= 0),
      ADD CONSTRAINT import_items_source_list_position_nonnegative
        CHECK (source_list_position >= 0);

    ALTER TABLE library.collections
      ADD CONSTRAINT collections_id_owner_unique UNIQUE (id, owner_membership_id);

    CREATE TABLE library.collection_import_provenance (
      collection_id uuid PRIMARY KEY,
      owner_membership_id uuid NOT NULL,
      provider_key text NOT NULL CHECK (provider_key IN ('naver', 'kakao', 'google')),
      source_connection_reference uuid NOT NULL,
      source_list_id text NOT NULL CHECK (length(source_list_id) BETWEEN 1 AND 512),
      source_name_snapshot text NOT NULL CHECK (length(source_name_snapshot) BETWEEN 1 AND 200),
      source_position integer NOT NULL CHECK (source_position >= 0),
      first_imported_at timestamptz NOT NULL,
      last_imported_at timestamptz NOT NULL,
      FOREIGN KEY (collection_id, owner_membership_id)
        REFERENCES library.collections (id, owner_membership_id),
      UNIQUE (provider_key, source_connection_reference, source_list_id),
      CHECK (last_imported_at >= first_imported_at)
    );

    CREATE INDEX collection_import_provenance_source
      ON library.collection_import_provenance (
        provider_key, source_connection_reference, source_list_id
      );

    GRANT SELECT, INSERT ON TABLE library.collection_import_provenance TO place_app;
    GRANT UPDATE (source_name_snapshot, source_position, last_imported_at)
      ON library.collection_import_provenance TO place_app;
  `)
}

export function down(pgm: MigrationBuilder): void {
  pgm.sql(`
    DROP TABLE library.collection_import_provenance;
    ALTER TABLE library.collections DROP CONSTRAINT collections_id_owner_unique;
    ALTER TABLE ingestion.import_items
      DROP CONSTRAINT import_items_source_position_nonnegative,
      DROP CONSTRAINT import_items_source_list_position_nonnegative,
      DROP CONSTRAINT import_items_source_list_id_length,
      DROP COLUMN source_position,
      DROP COLUMN source_list_position,
      DROP COLUMN source_list_id;
  `)
}
