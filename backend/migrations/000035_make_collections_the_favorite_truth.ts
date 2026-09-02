import type { MigrationBuilder } from 'node-pg-migrate'

export function up(pgm: MigrationBuilder): void {
  pgm.sql(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM library.place_preferences AS preference
        WHERE (preference.saved OR preference.wanted)
          AND NOT EXISTS (
            SELECT 1
            FROM library.collections AS collection
            JOIN library.collection_places AS collection_place
              ON collection_place.collection_id = collection.id
            WHERE collection.owner_membership_id = preference.membership_id
              AND collection_place.canonical_place_id = preference.canonical_place_id
          )
      ) THEN
        RAISE EXCEPTION USING
          MESSAGE = 'collection-first cutover requires every legacy saved/wanted Place to belong to an owned Collection',
          HINT = 'reconcile legacy preferences into user-selected Collections before applying migration 000035';
      END IF;
    END $$;

    ALTER TABLE library.collections
      ADD COLUMN revision bigint NOT NULL DEFAULT 1
        CHECK (revision > 0);

    ALTER TABLE library.place_preferences
      ADD COLUMN rating_revision bigint NOT NULL DEFAULT 0
        CHECK (rating_revision >= 0);

    UPDATE library.place_preferences
    SET rating_revision = 1
    WHERE personal_rating IS NOT NULL;

    CREATE TABLE library.member_revisions (
      membership_id uuid PRIMARY KEY REFERENCES access.memberships (id),
      collection_revision bigint NOT NULL DEFAULT 0 CHECK (collection_revision >= 0),
      tag_revision bigint NOT NULL DEFAULT 0 CHECK (tag_revision >= 0),
      updated_at timestamptz NOT NULL
    );

    INSERT INTO library.member_revisions (
      membership_id, collection_revision, tag_revision, updated_at
    )
    SELECT membership.id,
           CASE WHEN EXISTS (
             SELECT 1 FROM library.collections AS collection
             WHERE collection.owner_membership_id = membership.id
           ) THEN 1 ELSE 0 END,
           CASE WHEN EXISTS (
             SELECT 1 FROM library.tags AS tag
             WHERE tag.owner_membership_id = membership.id
           ) THEN 1 ELSE 0 END,
           greatest(
             membership.updated_at,
             coalesce((
               SELECT max(collection.updated_at)
               FROM library.collections AS collection
               WHERE collection.owner_membership_id = membership.id
             ), membership.updated_at)
           )
    FROM access.memberships AS membership;

    CREATE TABLE library.operation_receipts_v2 (
      operation_id uuid PRIMARY KEY,
      membership_id uuid NOT NULL REFERENCES access.memberships (id),
      operation_kind text NOT NULL CHECK (length(operation_kind) BETWEEN 1 AND 80),
      operation_fingerprint text NOT NULL
        CHECK (operation_fingerprint ~ '^[a-f0-9]{64}$'),
      outcome text NOT NULL CHECK (outcome IN (
        'applied',
        'not-found',
        'version-conflict',
        'operation-id-reused',
        'invalid-selection',
        'anchor-not-found',
        'source-membership-missing',
        'collection-limit-exceeded',
        'binding-version-conflict',
        'publication-changed'
      )),
      result jsonb NOT NULL CHECK (jsonb_typeof(result) = 'object'),
      occurred_at timestamptz NOT NULL
    );

    CREATE TABLE library.import_source_list_bindings (
      provider_key text NOT NULL CHECK (provider_key IN ('naver', 'kakao', 'google')),
      source_connection_reference uuid NOT NULL,
      source_list_id text NOT NULL CHECK (length(source_list_id) BETWEEN 1 AND 512),
      owner_membership_id uuid NOT NULL,
      collection_id uuid NOT NULL,
      source_name_snapshot text NOT NULL CHECK (length(source_name_snapshot) BETWEEN 1 AND 200),
      source_position integer NOT NULL CHECK (source_position >= 0),
      binding_revision bigint NOT NULL DEFAULT 1 CHECK (binding_revision > 0),
      first_bound_at timestamptz NOT NULL,
      last_materialized_at timestamptz NOT NULL,
      PRIMARY KEY (provider_key, source_connection_reference, source_list_id),
      FOREIGN KEY (collection_id, owner_membership_id)
        REFERENCES library.collections (id, owner_membership_id) ON DELETE CASCADE,
      CHECK (last_materialized_at >= first_bound_at)
    );

    INSERT INTO library.import_source_list_bindings (
      provider_key,
      source_connection_reference,
      source_list_id,
      owner_membership_id,
      collection_id,
      source_name_snapshot,
      source_position,
      first_bound_at,
      last_materialized_at
    )
    SELECT provider_key,
           source_connection_reference,
           source_list_id,
           owner_membership_id,
           collection_id,
           source_name_snapshot,
           source_position,
           first_imported_at,
           last_imported_at
    FROM library.collection_import_provenance;

    CREATE INDEX import_source_list_bindings_collection
      ON library.import_source_list_bindings (owner_membership_id, collection_id);

    CREATE TABLE library.publication_copy_operations (
      operation_id uuid PRIMARY KEY
        REFERENCES library.operation_receipts_v2 (operation_id),
      source_publication_id uuid NOT NULL,
      source_collection_revision bigint NOT NULL CHECK (source_collection_revision > 0),
      target_collection_id uuid NOT NULL REFERENCES library.collections (id) ON DELETE CASCADE,
      selection_kind text NOT NULL CHECK (selection_kind IN ('all', 'places')),
      copied_at timestamptz NOT NULL
    );

    CREATE TABLE library.publication_copy_items (
      operation_id uuid NOT NULL
        REFERENCES library.publication_copy_operations (operation_id) ON DELETE CASCADE,
      canonical_place_id uuid NOT NULL REFERENCES places.canonical_places (id),
      source_position integer NOT NULL CHECK (source_position >= 0),
      PRIMARY KEY (operation_id, canonical_place_id),
      UNIQUE (operation_id, source_position)
    );

    CREATE INDEX collection_places_place_collection
      ON library.collection_places (canonical_place_id, collection_id);

    GRANT SELECT, INSERT ON TABLE
      library.member_revisions,
      library.operation_receipts_v2,
      library.import_source_list_bindings,
      library.publication_copy_operations,
      library.publication_copy_items
    TO place_app;

    GRANT UPDATE (collection_revision, tag_revision, updated_at)
      ON TABLE library.member_revisions TO place_app;
    GRANT UPDATE (revision, updated_at)
      ON TABLE library.collections TO place_app;
    GRANT UPDATE (rating_revision, personal_rating, updated_at)
      ON TABLE library.place_preferences TO place_app;
    GRANT UPDATE (
      collection_id,
      source_name_snapshot,
      source_position,
      binding_revision,
      last_materialized_at
    ) ON TABLE library.import_source_list_bindings TO place_app;
  `)
}

export function down(pgm: MigrationBuilder): void {
  pgm.sql(`
    REVOKE UPDATE (rating_revision, personal_rating, updated_at)
      ON TABLE library.place_preferences FROM place_app;
    REVOKE UPDATE (revision, updated_at)
      ON TABLE library.collections FROM place_app;
    REVOKE UPDATE (collection_revision, tag_revision, updated_at)
      ON TABLE library.member_revisions FROM place_app;
    REVOKE UPDATE ON TABLE library.import_source_list_bindings FROM place_app;
    REVOKE SELECT, INSERT ON TABLE
      library.member_revisions,
      library.operation_receipts_v2,
      library.import_source_list_bindings,
      library.publication_copy_operations,
      library.publication_copy_items
    FROM place_app;

    DROP INDEX library.collection_places_place_collection;
    DROP TABLE library.publication_copy_items;
    DROP TABLE library.publication_copy_operations;
    DROP TABLE library.import_source_list_bindings;
    DROP TABLE library.operation_receipts_v2;
    DROP TABLE library.member_revisions;
    ALTER TABLE library.place_preferences DROP COLUMN rating_revision;
    ALTER TABLE library.collections DROP COLUMN revision;
  `)
}
