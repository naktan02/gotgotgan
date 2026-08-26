import type { MigrationBuilder } from 'node-pg-migrate'

export function up(pgm: MigrationBuilder): void {
  pgm.sql(`
    ALTER TABLE ingestion.import_items
      ADD COLUMN source_item_id text;

    UPDATE ingestion.import_items
    SET source_item_id = CASE
      WHEN left(source_item_key, length(source_list_id) + 1) = source_list_id || ':'
        THEN substring(source_item_key FROM length(source_list_id) + 2)
      ELSE source_item_key
    END;

    ALTER TABLE ingestion.import_items
      ALTER COLUMN source_item_id SET NOT NULL,
      ADD CONSTRAINT import_items_source_item_id_length
        CHECK (length(source_item_id) BETWEEN 1 AND 512),
      ADD CONSTRAINT import_items_source_item_identity_unique
        UNIQUE (batch_id, source_list_id, source_item_id);

    CREATE TABLE ingestion.provider_place_detail_statuses (
      provider_key text NOT NULL CHECK (provider_key IN ('naver', 'kakao', 'google')),
      provider_place_id text NOT NULL CHECK (length(provider_place_id) BETWEEN 1 AND 512),
      status text NOT NULL CHECK (status IN ('pending', 'available')),
      last_detail_observation_id uuid REFERENCES ingestion.source_observations(id),
      requested_at timestamptz NOT NULL,
      updated_at timestamptz NOT NULL,
      PRIMARY KEY (provider_key, provider_place_id),
      CHECK ((status = 'available') = (last_detail_observation_id IS NOT NULL)),
      CHECK (updated_at >= requested_at)
    );

    INSERT INTO ingestion.provider_place_detail_statuses (
      provider_key, provider_place_id, status, requested_at, updated_at
    )
    SELECT batch.provider_key, imported.provider_place_id, 'pending',
           min(imported.created_at), max(imported.updated_at)
    FROM ingestion.import_items AS imported
    JOIN ingestion.import_batches AS batch ON batch.id = imported.batch_id
    WHERE imported.provider_place_id IS NOT NULL
    GROUP BY batch.provider_key, imported.provider_place_id;

    CREATE TABLE library.collection_place_import_provenance (
      collection_id uuid NOT NULL,
      canonical_place_id uuid NOT NULL,
      provider_key text NOT NULL CHECK (provider_key IN ('naver', 'kakao', 'google')),
      source_connection_reference uuid NOT NULL,
      source_list_id text NOT NULL CHECK (length(source_list_id) BETWEEN 1 AND 512),
      source_item_id text NOT NULL CHECK (length(source_item_id) BETWEEN 1 AND 512),
      provider_place_id text NOT NULL CHECK (length(provider_place_id) BETWEEN 1 AND 512),
      first_imported_at timestamptz NOT NULL,
      last_imported_at timestamptz NOT NULL,
      PRIMARY KEY (collection_id, canonical_place_id),
      FOREIGN KEY (collection_id, canonical_place_id)
        REFERENCES library.collection_places (collection_id, canonical_place_id),
      UNIQUE (
        provider_key, source_connection_reference, source_list_id, source_item_id
      ),
      CHECK (last_imported_at >= first_imported_at)
    );

    CREATE INDEX collection_place_import_provenance_provider_place
      ON library.collection_place_import_provenance (provider_key, provider_place_id);

    GRANT SELECT, INSERT ON TABLE ingestion.provider_place_detail_statuses TO place_app;
    GRANT UPDATE (status, last_detail_observation_id, updated_at)
      ON ingestion.provider_place_detail_statuses TO place_app;
    GRANT SELECT, INSERT ON TABLE library.collection_place_import_provenance TO place_app;
    GRANT UPDATE (
      provider_key, source_connection_reference, source_list_id, source_item_id,
      provider_place_id, last_imported_at
    ) ON library.collection_place_import_provenance TO place_app;
  `)
}

export function down(pgm: MigrationBuilder): void {
  pgm.sql(`
    DROP TABLE library.collection_place_import_provenance;
    DROP TABLE ingestion.provider_place_detail_statuses;
    ALTER TABLE ingestion.import_items
      DROP CONSTRAINT import_items_source_item_identity_unique,
      DROP CONSTRAINT import_items_source_item_id_length,
      DROP COLUMN source_item_id;
  `)
}
