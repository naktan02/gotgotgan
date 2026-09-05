import type { MigrationBuilder } from 'node-pg-migrate'

export function up(pgm: MigrationBuilder): void {
  pgm.sql(`
    CREATE TABLE transfers.import_sources (
      id uuid PRIMARY KEY,
      owner_membership_id uuid NOT NULL
        REFERENCES access.memberships (id) ON DELETE RESTRICT,
      provider_key text NOT NULL CHECK (provider_key IN ('naver', 'kakao', 'google')),
      source_kind text NOT NULL CHECK (source_kind IN (
        'verified-connection', 'one-shot', 'legacy-reference'
      )),
      connection_id uuid UNIQUE,
      acquisition_method text CHECK (acquisition_method IN ('shared-link', 'remote-browser')),
      authorization_basis text CHECK (authorization_basis IN (
        'link-possession', 'interactive-provider-session'
      )),
      created_at timestamptz NOT NULL,
      FOREIGN KEY (connection_id, owner_membership_id, provider_key)
        REFERENCES transfers.provider_connections (id, owner_membership_id, provider_key)
        ON DELETE RESTRICT,
      UNIQUE (id, owner_membership_id, provider_key),
      UNIQUE (id, owner_membership_id, provider_key, source_kind),
      UNIQUE (id, owner_membership_id, provider_key, source_kind, connection_id),
      CHECK (
        (source_kind = 'verified-connection' AND connection_id IS NOT NULL
          AND acquisition_method IS NULL AND authorization_basis IS NULL)
        OR (source_kind = 'one-shot' AND connection_id IS NULL
          AND (
            (acquisition_method = 'shared-link' AND authorization_basis = 'link-possession')
            OR (acquisition_method = 'remote-browser'
              AND authorization_basis = 'interactive-provider-session')
          ))
        OR (source_kind = 'legacy-reference' AND connection_id IS NULL
          AND acquisition_method IS NULL AND authorization_basis IS NULL)
      )
    );

    COMMENT ON TABLE transfers.import_sources IS
      'Credential-free import identity. one-shot and legacy-reference rows never assert provider account ownership.';

    INSERT INTO transfers.import_sources (
      id, owner_membership_id, provider_key, source_kind, connection_id, created_at
    )
    SELECT id, owner_membership_id, provider_key, 'verified-connection', id, created_at
    FROM transfers.provider_connections;

    DO $$
    BEGIN
      IF EXISTS (
        WITH candidates AS (
          SELECT source_connection_reference AS id, owner_membership_id, provider_key
          FROM library.collection_import_provenance
          UNION ALL
          SELECT source_connection_reference, owner_membership_id, provider_key
          FROM library.import_source_list_bindings
          UNION ALL
          SELECT provenance.source_connection_reference,
                 collection.owner_membership_id,
                 provenance.provider_key
          FROM library.collection_place_import_provenance AS provenance
          JOIN library.collections AS collection ON collection.id = provenance.collection_id
        )
        SELECT 1 FROM candidates
        GROUP BY id
        HAVING count(DISTINCT (owner_membership_id::text || ':' || provider_key)) > 1
      ) THEN
        RAISE EXCEPTION 'legacy import source reference is shared across owners or providers';
      END IF;
    END $$;

    WITH candidates AS (
      SELECT source_connection_reference AS id, owner_membership_id, provider_key,
             first_imported_at AS created_at
      FROM library.collection_import_provenance
      UNION ALL
      SELECT source_connection_reference, owner_membership_id, provider_key, first_bound_at
      FROM library.import_source_list_bindings
      UNION ALL
      SELECT provenance.source_connection_reference,
             collection.owner_membership_id,
             provenance.provider_key,
             provenance.first_imported_at
      FROM library.collection_place_import_provenance AS provenance
      JOIN library.collections AS collection ON collection.id = provenance.collection_id
    ), earliest AS (
      SELECT id, owner_membership_id, provider_key, min(created_at) AS created_at
      FROM candidates
      GROUP BY id, owner_membership_id, provider_key
    )
    INSERT INTO transfers.import_sources (
      id, owner_membership_id, provider_key, source_kind, connection_id, created_at
    )
    SELECT candidate.id, candidate.owner_membership_id, candidate.provider_key,
           'legacy-reference', NULL, candidate.created_at
    FROM earliest AS candidate
    WHERE NOT EXISTS (
      SELECT 1 FROM transfers.import_sources AS source WHERE source.id = candidate.id
    );

    ALTER TABLE transfers.source_snapshots
      ADD COLUMN import_source_id uuid,
      ADD COLUMN import_source_kind text;
    UPDATE transfers.source_snapshots
    SET import_source_id = connection_id,
        import_source_kind = 'verified-connection';
    ALTER TABLE transfers.source_snapshots
      ALTER COLUMN import_source_id SET NOT NULL,
      ALTER COLUMN import_source_kind SET NOT NULL,
      ALTER COLUMN connection_id DROP NOT NULL,
      ADD CONSTRAINT source_snapshots_import_source_kind_check CHECK (
        import_source_kind IN ('verified-connection', 'one-shot')
      ),
      ADD CONSTRAINT source_snapshots_import_source_shape_check CHECK (
        (import_source_kind = 'verified-connection' AND connection_id IS NOT NULL)
        OR (import_source_kind = 'one-shot' AND connection_id IS NULL)
      ),
      ADD CONSTRAINT source_snapshots_import_source_fk FOREIGN KEY (
        import_source_id, owner_membership_id, provider_key, import_source_kind
      ) REFERENCES transfers.import_sources (
        id, owner_membership_id, provider_key, source_kind
      ) ON DELETE RESTRICT,
      ADD CONSTRAINT source_snapshots_verified_connection_source_fk FOREIGN KEY (
        import_source_id, owner_membership_id, provider_key, import_source_kind, connection_id
      ) REFERENCES transfers.import_sources (
        id, owner_membership_id, provider_key, source_kind, connection_id
      ) ON DELETE RESTRICT,
      ADD CONSTRAINT source_snapshots_import_source_revision_unique UNIQUE (
        import_source_id, source_revision
      );

    CREATE FUNCTION transfers.default_verified_snapshot_import_source()
    RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.import_source_id IS NULL AND NEW.connection_id IS NOT NULL THEN
        NEW.import_source_id := NEW.connection_id;
        NEW.import_source_kind := 'verified-connection';
      END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER source_snapshot_verified_import_source_default
      BEFORE INSERT ON transfers.source_snapshots
      FOR EACH ROW EXECUTE FUNCTION transfers.default_verified_snapshot_import_source();

    ALTER TABLE library.collection_import_provenance
      ADD COLUMN import_source_id uuid,
      ADD COLUMN import_source_kind text;
    UPDATE library.collection_import_provenance AS provenance
    SET import_source_id = provenance.source_connection_reference,
        import_source_kind = source.source_kind
    FROM transfers.import_sources AS source
    WHERE source.id = provenance.source_connection_reference
      AND source.owner_membership_id = provenance.owner_membership_id
      AND source.provider_key = provenance.provider_key;
    UPDATE library.collection_import_provenance
    SET source_connection_reference = NULL
    WHERE import_source_kind <> 'verified-connection';
    DO $$
    DECLARE old_source_identity_constraint text;
    BEGIN
      SELECT constraint_name INTO old_source_identity_constraint
      FROM information_schema.table_constraints AS table_constraint
      WHERE table_constraint.table_schema = 'library'
        AND table_constraint.table_name = 'collection_import_provenance'
        AND table_constraint.constraint_type = 'UNIQUE'
        AND (
          SELECT array_agg(key_column.column_name::text ORDER BY key_column.ordinal_position)
          FROM information_schema.key_column_usage AS key_column
          WHERE key_column.constraint_schema = table_constraint.constraint_schema
            AND key_column.constraint_name = table_constraint.constraint_name
        ) = ARRAY[
          'provider_key', 'source_connection_reference', 'source_list_id'
        ]::text[];
      IF old_source_identity_constraint IS NULL THEN
        RAISE EXCEPTION 'collection import source identity constraint is unavailable';
      END IF;
      EXECUTE format(
        'ALTER TABLE library.collection_import_provenance DROP CONSTRAINT %I',
        old_source_identity_constraint
      );
    END $$;
    ALTER TABLE library.collection_import_provenance
      ALTER COLUMN import_source_id SET NOT NULL,
      ALTER COLUMN import_source_kind SET NOT NULL,
      ALTER COLUMN source_connection_reference DROP NOT NULL,
      ADD CONSTRAINT collection_import_provenance_source_shape_check CHECK (
        (import_source_kind = 'verified-connection' AND source_connection_reference IS NOT NULL)
        OR (import_source_kind = 'legacy-reference' AND source_connection_reference IS NULL)
      ),
      ADD CONSTRAINT collection_import_provenance_import_source_fk FOREIGN KEY (
        import_source_id, owner_membership_id, provider_key, import_source_kind
      ) REFERENCES transfers.import_sources (
        id, owner_membership_id, provider_key, source_kind
      ) ON DELETE RESTRICT,
      ADD CONSTRAINT collection_import_provenance_verified_source_fk FOREIGN KEY (
        import_source_id, owner_membership_id, provider_key,
        import_source_kind, source_connection_reference
      ) REFERENCES transfers.import_sources (
        id, owner_membership_id, provider_key, source_kind, connection_id
      ) ON DELETE RESTRICT,
      ADD CONSTRAINT collection_import_provenance_import_source_unique UNIQUE (
        provider_key, import_source_id, source_list_id
      );

    ALTER TABLE library.import_source_list_bindings
      ADD COLUMN import_source_id uuid,
      ADD COLUMN import_source_kind text;
    UPDATE library.import_source_list_bindings AS binding
    SET import_source_id = binding.source_connection_reference,
        import_source_kind = source.source_kind
    FROM transfers.import_sources AS source
    WHERE source.id = binding.source_connection_reference
      AND source.owner_membership_id = binding.owner_membership_id
      AND source.provider_key = binding.provider_key;
    UPDATE library.import_source_list_bindings
    SET source_connection_reference = NULL
    WHERE import_source_kind <> 'verified-connection';
    ALTER TABLE library.import_source_list_bindings
      DROP CONSTRAINT import_source_list_bindings_pkey,
      ALTER COLUMN import_source_id SET NOT NULL,
      ALTER COLUMN import_source_kind SET NOT NULL,
      ALTER COLUMN source_connection_reference DROP NOT NULL,
      ADD CONSTRAINT import_source_list_bindings_source_shape_check CHECK (
        (import_source_kind = 'verified-connection' AND source_connection_reference IS NOT NULL)
        OR (import_source_kind IN ('one-shot', 'legacy-reference')
          AND source_connection_reference IS NULL)
      ),
      ADD CONSTRAINT import_source_list_bindings_import_source_fk FOREIGN KEY (
        import_source_id, owner_membership_id, provider_key, import_source_kind
      ) REFERENCES transfers.import_sources (
        id, owner_membership_id, provider_key, source_kind
      ) ON DELETE RESTRICT,
      ADD CONSTRAINT import_source_list_bindings_verified_source_fk FOREIGN KEY (
        import_source_id, owner_membership_id, provider_key,
        import_source_kind, source_connection_reference
      ) REFERENCES transfers.import_sources (
        id, owner_membership_id, provider_key, source_kind, connection_id
      ) ON DELETE RESTRICT,
      ADD CONSTRAINT import_source_list_bindings_pkey PRIMARY KEY (
        provider_key, import_source_id, source_list_id
      );

    ALTER TABLE library.collection_place_import_provenance
      ADD COLUMN owner_membership_id uuid,
      ADD COLUMN import_source_id uuid,
      ADD COLUMN import_source_kind text;
    UPDATE library.collection_place_import_provenance AS provenance
    SET owner_membership_id = collection.owner_membership_id,
        import_source_id = provenance.source_connection_reference,
        import_source_kind = source.source_kind
    FROM library.collections AS collection,
         transfers.import_sources AS source
    WHERE collection.id = provenance.collection_id
      AND source.id = provenance.source_connection_reference
      AND source.owner_membership_id = collection.owner_membership_id
      AND source.provider_key = provenance.provider_key;
    UPDATE library.collection_place_import_provenance
    SET source_connection_reference = NULL
    WHERE import_source_kind <> 'verified-connection';
    ALTER TABLE library.collection_place_import_provenance
      DROP CONSTRAINT collection_place_import_provenance_pkey,
      ALTER COLUMN owner_membership_id SET NOT NULL,
      ALTER COLUMN import_source_id SET NOT NULL,
      ALTER COLUMN import_source_kind SET NOT NULL,
      ALTER COLUMN source_connection_reference DROP NOT NULL,
      ADD CONSTRAINT collection_place_import_provenance_source_shape_check CHECK (
        (import_source_kind = 'verified-connection' AND source_connection_reference IS NOT NULL)
        OR (import_source_kind IN ('one-shot', 'legacy-reference')
          AND source_connection_reference IS NULL)
      ),
      ADD CONSTRAINT collection_place_import_provenance_collection_owner_fk FOREIGN KEY (
        collection_id, owner_membership_id
      ) REFERENCES library.collections (id, owner_membership_id) ON DELETE CASCADE,
      ADD CONSTRAINT collection_place_import_provenance_import_source_fk FOREIGN KEY (
        import_source_id, owner_membership_id, provider_key, import_source_kind
      ) REFERENCES transfers.import_sources (
        id, owner_membership_id, provider_key, source_kind
      ) ON DELETE RESTRICT,
      ADD CONSTRAINT collection_place_import_provenance_verified_source_fk FOREIGN KEY (
        import_source_id, owner_membership_id, provider_key,
        import_source_kind, source_connection_reference
      ) REFERENCES transfers.import_sources (
        id, owner_membership_id, provider_key, source_kind, connection_id
      ) ON DELETE RESTRICT,
      ADD CONSTRAINT collection_place_import_provenance_pkey PRIMARY KEY (
        provider_key, import_source_id, source_list_id, source_item_id
      );

    CREATE INDEX import_sources_owner
      ON transfers.import_sources (owner_membership_id, provider_key, created_at DESC, id DESC);

    GRANT SELECT, INSERT ON TABLE transfers.import_sources TO place_app;
  `)
}

export function down(pgm: MigrationBuilder): void {
  pgm.sql(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM transfers.source_snapshots WHERE import_source_kind = 'one-shot'
      ) OR EXISTS (
        SELECT 1 FROM library.import_source_list_bindings WHERE import_source_kind = 'one-shot'
      ) OR EXISTS (
        SELECT 1 FROM library.collection_place_import_provenance
        WHERE import_source_kind = 'one-shot'
      ) THEN
        RAISE EXCEPTION 'one-shot import data must be migrated before rolling back migration 000049';
      END IF;
    END $$;

    ALTER TABLE library.collection_place_import_provenance
      DROP CONSTRAINT collection_place_import_provenance_verified_source_fk,
      DROP CONSTRAINT collection_place_import_provenance_import_source_fk,
      DROP CONSTRAINT collection_place_import_provenance_collection_owner_fk,
      DROP CONSTRAINT collection_place_import_provenance_source_shape_check,
      DROP CONSTRAINT collection_place_import_provenance_pkey;
    UPDATE library.collection_place_import_provenance
    SET source_connection_reference = import_source_id
    WHERE source_connection_reference IS NULL;
    ALTER TABLE library.collection_place_import_provenance
      ALTER COLUMN source_connection_reference SET NOT NULL,
      ADD CONSTRAINT collection_place_import_provenance_pkey PRIMARY KEY (
        provider_key, source_connection_reference, source_list_id, source_item_id
      ),
      DROP COLUMN import_source_kind,
      DROP COLUMN import_source_id,
      DROP COLUMN owner_membership_id;

    ALTER TABLE library.import_source_list_bindings
      DROP CONSTRAINT import_source_list_bindings_verified_source_fk,
      DROP CONSTRAINT import_source_list_bindings_import_source_fk,
      DROP CONSTRAINT import_source_list_bindings_source_shape_check,
      DROP CONSTRAINT import_source_list_bindings_pkey;
    UPDATE library.import_source_list_bindings
    SET source_connection_reference = import_source_id
    WHERE source_connection_reference IS NULL;
    ALTER TABLE library.import_source_list_bindings
      ALTER COLUMN source_connection_reference SET NOT NULL,
      ADD CONSTRAINT import_source_list_bindings_pkey PRIMARY KEY (
        provider_key, source_connection_reference, source_list_id
      ),
      DROP COLUMN import_source_kind,
      DROP COLUMN import_source_id;

    ALTER TABLE library.collection_import_provenance
      DROP CONSTRAINT collection_import_provenance_verified_source_fk,
      DROP CONSTRAINT collection_import_provenance_import_source_fk,
      DROP CONSTRAINT collection_import_provenance_source_shape_check,
      DROP CONSTRAINT collection_import_provenance_import_source_unique;
    UPDATE library.collection_import_provenance
    SET source_connection_reference = import_source_id
    WHERE source_connection_reference IS NULL;
    ALTER TABLE library.collection_import_provenance
      ALTER COLUMN source_connection_reference SET NOT NULL,
      ADD CONSTRAINT collection_import_provenance_source_identity_unique UNIQUE (
        provider_key, source_connection_reference, source_list_id
      ),
      DROP COLUMN import_source_kind,
      DROP COLUMN import_source_id;

    ALTER TABLE transfers.source_snapshots
      DROP CONSTRAINT source_snapshots_import_source_revision_unique;
    DROP TRIGGER source_snapshot_verified_import_source_default
      ON transfers.source_snapshots;
    DROP FUNCTION transfers.default_verified_snapshot_import_source();
    ALTER TABLE transfers.source_snapshots
      DROP CONSTRAINT source_snapshots_verified_connection_source_fk,
      DROP CONSTRAINT source_snapshots_import_source_fk,
      DROP CONSTRAINT source_snapshots_import_source_shape_check,
      DROP CONSTRAINT source_snapshots_import_source_kind_check,
      ALTER COLUMN connection_id SET NOT NULL,
      DROP COLUMN import_source_kind,
      DROP COLUMN import_source_id;

    DROP TABLE transfers.import_sources;
  `)
}
