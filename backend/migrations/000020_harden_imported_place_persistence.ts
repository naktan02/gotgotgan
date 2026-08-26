import type { MigrationBuilder } from 'node-pg-migrate'

export function up(pgm: MigrationBuilder): void {
  pgm.sql(`
    ALTER TABLE library.collection_place_import_provenance
      DROP CONSTRAINT collection_place_import_provenance_pkey;

    DO $$
    DECLARE
      source_identity_constraint text;
    BEGIN
      SELECT constraint_name INTO source_identity_constraint
      FROM information_schema.table_constraints AS table_constraint
      WHERE table_constraint.table_schema = 'library'
        AND table_constraint.table_name = 'collection_place_import_provenance'
        AND table_constraint.constraint_type = 'UNIQUE'
        AND (
          SELECT array_agg(key_column.column_name::text ORDER BY key_column.ordinal_position)
          FROM information_schema.key_column_usage AS key_column
          WHERE key_column.constraint_schema = table_constraint.constraint_schema
            AND key_column.constraint_name = table_constraint.constraint_name
        ) = ARRAY[
          'provider_key', 'source_connection_reference', 'source_list_id', 'source_item_id'
        ]::text[];

      IF source_identity_constraint IS NULL THEN
        RAISE EXCEPTION 'collection place import source identity constraint is unavailable';
      END IF;
      EXECUTE format(
        'ALTER TABLE library.collection_place_import_provenance DROP CONSTRAINT %I',
        source_identity_constraint
      );
    END $$;

    ALTER TABLE library.collection_place_import_provenance
      ADD CONSTRAINT collection_place_import_provenance_pkey PRIMARY KEY (
        provider_key, source_connection_reference, source_list_id, source_item_id
      );

    REVOKE UPDATE ON TABLE library.collection_place_import_provenance FROM place_app;
    GRANT UPDATE (
      collection_id, canonical_place_id, provider_place_id, last_imported_at
    ) ON library.collection_place_import_provenance TO place_app;

    ALTER TABLE ingestion.source_observations
      ADD COLUMN observation_kind text NOT NULL DEFAULT 'general',
      ADD CONSTRAINT source_observations_observation_kind_check
        CHECK (observation_kind IN ('general', 'provider-detail'));

    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM ingestion.provider_place_detail_statuses AS detail_status
        LEFT JOIN ingestion.source_observations AS observation
          ON observation.id = detail_status.last_detail_observation_id
        WHERE detail_status.status = 'available'
          AND (
            observation.id IS NULL
            OR observation.provider_key <> detail_status.provider_key
            OR observation.external_place_id <> detail_status.provider_place_id
            OR NOT EXISTS (
              SELECT 1 FROM ingestion.place_candidates AS candidate
              WHERE candidate.source_observation_id = observation.id
            )
          )
      ) THEN
        RAISE EXCEPTION 'available provider detail is not backed by matching normalized evidence';
      END IF;
    END $$;

    UPDATE ingestion.source_observations AS observation
    SET observation_kind = 'provider-detail'
    FROM ingestion.provider_place_detail_statuses AS detail_status
    WHERE detail_status.status = 'available'
      AND detail_status.last_detail_observation_id = observation.id;

    ALTER TABLE ingestion.source_observations
      ADD CONSTRAINT source_observations_provider_detail_reference_unique
        UNIQUE (provider_key, external_place_id, id, observation_kind);

    ALTER TABLE ingestion.place_candidates
      ADD CONSTRAINT place_candidates_observation_candidate_unique
        UNIQUE (source_observation_id, id);

    CREATE TABLE ingestion.provider_place_detail_observations (
      provider_key text NOT NULL CHECK (provider_key IN ('naver', 'kakao', 'google')),
      provider_place_id text NOT NULL CHECK (length(provider_place_id) BETWEEN 1 AND 512),
      source_observation_id uuid NOT NULL,
      observation_kind text NOT NULL DEFAULT 'provider-detail'
        CHECK (observation_kind = 'provider-detail'),
      place_candidate_id uuid NOT NULL,
      normalized_at timestamptz NOT NULL,
      PRIMARY KEY (provider_key, provider_place_id, source_observation_id),
      UNIQUE (source_observation_id),
      UNIQUE (place_candidate_id),
      FOREIGN KEY (
        provider_key, provider_place_id, source_observation_id, observation_kind
      ) REFERENCES ingestion.source_observations (
        provider_key, external_place_id, id, observation_kind
      ),
      FOREIGN KEY (source_observation_id, place_candidate_id)
        REFERENCES ingestion.place_candidates (source_observation_id, id)
    );

    INSERT INTO ingestion.provider_place_detail_observations (
      provider_key, provider_place_id, source_observation_id,
      place_candidate_id, normalized_at
    )
    SELECT detail_status.provider_key, detail_status.provider_place_id,
           detail_status.last_detail_observation_id, candidate.id,
           detail_status.updated_at
    FROM ingestion.provider_place_detail_statuses AS detail_status
    JOIN LATERAL (
      SELECT normalized.id
      FROM ingestion.place_candidates AS normalized
      WHERE normalized.source_observation_id = detail_status.last_detail_observation_id
      ORDER BY normalized.created_at DESC, normalized.id DESC
      LIMIT 1
    ) AS candidate ON true
    WHERE detail_status.status = 'available';

    ALTER TABLE ingestion.provider_place_detail_statuses
      ADD CONSTRAINT provider_place_detail_statuses_normalized_detail_fk
      FOREIGN KEY (provider_key, provider_place_id, last_detail_observation_id)
      REFERENCES ingestion.provider_place_detail_observations (
        provider_key, provider_place_id, source_observation_id
      );

    GRANT SELECT, INSERT
      ON TABLE ingestion.provider_place_detail_observations TO place_app;
  `)
}

export function down(pgm: MigrationBuilder): void {
  pgm.sql(`
    ALTER TABLE ingestion.provider_place_detail_statuses
      DROP CONSTRAINT provider_place_detail_statuses_normalized_detail_fk;
    DROP TABLE ingestion.provider_place_detail_observations;
    ALTER TABLE ingestion.place_candidates
      DROP CONSTRAINT place_candidates_observation_candidate_unique;
    ALTER TABLE ingestion.source_observations
      DROP CONSTRAINT source_observations_provider_detail_reference_unique,
      DROP CONSTRAINT source_observations_observation_kind_check,
      DROP COLUMN observation_kind;

    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM library.collection_place_import_provenance
        GROUP BY collection_id, canonical_place_id
        HAVING count(*) > 1
      ) THEN
        RAISE EXCEPTION 'cannot restore membership-keyed provenance without losing source items';
      END IF;
    END $$;

    ALTER TABLE library.collection_place_import_provenance
      DROP CONSTRAINT collection_place_import_provenance_pkey,
      ADD CONSTRAINT collection_place_import_provenance_pkey
        PRIMARY KEY (collection_id, canonical_place_id),
      ADD CONSTRAINT collection_place_import_provenance_source_identity_unique
        UNIQUE (provider_key, source_connection_reference, source_list_id, source_item_id);

    REVOKE UPDATE ON TABLE library.collection_place_import_provenance FROM place_app;
    GRANT UPDATE (
      provider_key, source_connection_reference, source_list_id, source_item_id,
      provider_place_id, last_imported_at
    ) ON library.collection_place_import_provenance TO place_app;
  `)
}
