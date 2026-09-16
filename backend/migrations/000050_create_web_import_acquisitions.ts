import type { MigrationBuilder } from 'node-pg-migrate'

export function up(pgm: MigrationBuilder): void {
  pgm.sql(`
    ALTER TABLE transfers.import_plans
      DROP CONSTRAINT import_plans_contract_major_check,
      ADD CONSTRAINT import_plans_contract_major_check CHECK (contract_major IN (2, 3, 4));

    ALTER TABLE transfers.operations
      ADD COLUMN import_source_id uuid,
      ADD COLUMN import_source_kind text;

    UPDATE transfers.operations
    SET import_source_id = connection_id,
        import_source_kind = 'verified-connection'
    WHERE connection_id IS NOT NULL;

    DO $$
    DECLARE provider_connection_shape text;
    BEGIN
      SELECT checked_constraint.conname INTO provider_connection_shape
      FROM pg_constraint AS checked_constraint
      JOIN pg_class AS relation ON relation.oid = checked_constraint.conrelid
      JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'transfers' AND relation.relname = 'operations'
        AND checked_constraint.contype = 'c'
        AND pg_get_constraintdef(checked_constraint.oid)
          LIKE '%provider_key IS NULL%connection_id IS NULL%';
      IF provider_connection_shape IS NULL THEN
        RAISE EXCEPTION 'operations provider/connection shape constraint is unavailable';
      END IF;
      EXECUTE format('ALTER TABLE transfers.operations DROP CONSTRAINT %I', provider_connection_shape);
    END $$;

    ALTER TABLE transfers.operations
      ADD CONSTRAINT operations_import_source_kind_check CHECK (
        import_source_kind IN ('verified-connection', 'one-shot')
      ),
      ADD CONSTRAINT operations_import_source_shape_check CHECK (
        (kind = 'account-erasure' AND provider_key IS NULL AND connection_id IS NULL
          AND import_source_id IS NULL AND import_source_kind IS NULL)
        OR (kind IN ('import-capture', 'outbound-transfer') AND provider_key IS NOT NULL
          AND connection_id IS NOT NULL AND import_source_id IS NOT NULL
          AND import_source_kind = 'verified-connection')
        OR (kind = 'import-materialization' AND provider_key IS NOT NULL
          AND import_source_id IS NOT NULL
          AND (
            (import_source_kind = 'verified-connection' AND connection_id IS NOT NULL)
            OR (import_source_kind = 'one-shot' AND connection_id IS NULL)
          ))
      ),
      ADD CONSTRAINT operations_import_source_fk FOREIGN KEY (
        import_source_id, owner_membership_id, provider_key, import_source_kind
      ) REFERENCES transfers.import_sources (
        id, owner_membership_id, provider_key, source_kind
      ) ON DELETE RESTRICT,
      ADD CONSTRAINT operations_verified_import_source_fk FOREIGN KEY (
        import_source_id, owner_membership_id, provider_key,
        import_source_kind, connection_id
      ) REFERENCES transfers.import_sources (
        id, owner_membership_id, provider_key, source_kind, connection_id
      ) ON DELETE RESTRICT;

    CREATE FUNCTION transfers.default_operation_import_source()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $default_operation_import_source$
    BEGIN
      IF NEW.connection_id IS NOT NULL
        AND NEW.import_source_id IS NULL AND NEW.import_source_kind IS NULL THEN
        NEW.import_source_id := NEW.connection_id;
        NEW.import_source_kind := 'verified-connection';
      END IF;
      RETURN NEW;
    END;
    $default_operation_import_source$;

    CREATE TRIGGER default_operation_import_source
    BEFORE INSERT ON transfers.operations
    FOR EACH ROW EXECUTE FUNCTION transfers.default_operation_import_source();

    ALTER TABLE library.collection_import_provenance
      DROP CONSTRAINT collection_import_provenance_source_shape_check,
      ADD CONSTRAINT collection_import_provenance_source_shape_check CHECK (
        (import_source_kind = 'verified-connection' AND source_connection_reference IS NOT NULL)
        OR (import_source_kind IN ('one-shot', 'legacy-reference')
          AND source_connection_reference IS NULL)
      );

    ALTER TABLE transfers.source_snapshots
      ADD CONSTRAINT source_snapshots_web_acquisition_identity_unique UNIQUE (
        id, owner_membership_id, import_source_id, provider_key, import_source_kind
      );

    CREATE TABLE transfers.web_import_acquisitions (
      id uuid PRIMARY KEY,
      command_id uuid NOT NULL UNIQUE,
      owner_membership_id uuid NOT NULL REFERENCES access.memberships (id) ON DELETE RESTRICT,
      import_source_id uuid NOT NULL,
      provider_key text NOT NULL CHECK (provider_key = 'naver'),
      import_source_kind text NOT NULL DEFAULT 'one-shot'
        CHECK (import_source_kind = 'one-shot'),
      method text NOT NULL CHECK (method IN ('shared-links', 'remote-browser')),
      state text NOT NULL CHECK (state IN (
        'processing', 'ready', 'partial', 'failed', 'cancelled', 'expired'
      )),
      revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
      request_fingerprint text NOT NULL CHECK (request_fingerprint ~ '^[a-f0-9]{64}$'),
      snapshot_id uuid,
      ready_count integer NOT NULL DEFAULT 0 CHECK (ready_count BETWEEN 0 AND 20),
      failed_count integer NOT NULL DEFAULT 0 CHECK (failed_count BETWEEN 0 AND 20),
      created_at timestamptz NOT NULL,
      updated_at timestamptz NOT NULL,
      completed_at timestamptz,
      FOREIGN KEY (import_source_id, owner_membership_id, provider_key, import_source_kind)
        REFERENCES transfers.import_sources (id, owner_membership_id, provider_key, source_kind)
        ON DELETE RESTRICT,
      FOREIGN KEY (
        snapshot_id, owner_membership_id, import_source_id, provider_key, import_source_kind
      ) REFERENCES transfers.source_snapshots (
        id, owner_membership_id, import_source_id, provider_key, import_source_kind
      )
        ON DELETE RESTRICT,
      CHECK ((snapshot_id IS NULL) = (ready_count = 0)),
      CHECK (state IN ('processing') OR completed_at IS NOT NULL),
      CHECK (state = 'processing' OR completed_at >= created_at),
      CHECK (updated_at >= created_at),
      UNIQUE (id, owner_membership_id)
    );

    CREATE TABLE transfers.web_import_acquisition_items (
      acquisition_id uuid NOT NULL REFERENCES transfers.web_import_acquisitions (id)
        ON DELETE RESTRICT,
      entry_id uuid NOT NULL,
      source_position integer NOT NULL CHECK (source_position BETWEEN 0 AND 19),
      input_digest text NOT NULL CHECK (input_digest ~ '^[a-f0-9]{64}$'),
      state text NOT NULL CHECK (state IN (
        'pending', 'fetching', 'ready', 'duplicate',
        'invalid', 'unavailable', 'rate-limited', 'failed'
      )),
      source_list_id text CHECK (length(source_list_id) BETWEEN 1 AND 512),
      observed_name text CHECK (length(observed_name) BETWEEN 1 AND 200),
      item_count integer CHECK (item_count BETWEEN 0 AND 500),
      duplicate_of_entry_id uuid,
      failure_code text CHECK (failure_code IN (
        'invalid-url', 'unsupported-host', 'redirect-policy-denied',
        'share-not-found', 'share-not-readable', 'provider-rate-limited',
        'provider-unavailable', 'request-timeout', 'response-too-large',
        'source-limit-exceeded', 'provider-parser-drift',
        'remote-browser-integration-gated', 'session-expired', 'session-cleanup-required'
      )),
      failure_retryable boolean,
      updated_at timestamptz NOT NULL,
      PRIMARY KEY (acquisition_id, entry_id),
      UNIQUE (acquisition_id, source_position),
      UNIQUE (acquisition_id, entry_id, state),
      FOREIGN KEY (acquisition_id, duplicate_of_entry_id)
        REFERENCES transfers.web_import_acquisition_items (acquisition_id, entry_id)
        ON DELETE RESTRICT,
      CHECK (
        (state = 'ready' AND source_list_id IS NOT NULL
          AND observed_name IS NOT NULL AND item_count IS NOT NULL
          AND duplicate_of_entry_id IS NULL AND failure_code IS NULL
          AND failure_retryable IS NULL)
        OR (state = 'duplicate' AND duplicate_of_entry_id IS NOT NULL
          AND source_list_id IS NULL AND observed_name IS NULL AND item_count IS NULL
          AND failure_code IS NULL AND failure_retryable IS NULL)
        OR (state IN ('invalid', 'unavailable', 'rate-limited', 'failed')
          AND failure_code IS NOT NULL AND failure_retryable IS NOT NULL
          AND source_list_id IS NULL AND observed_name IS NULL AND item_count IS NULL
          AND duplicate_of_entry_id IS NULL)
        OR (state IN ('pending', 'fetching') AND source_list_id IS NULL
          AND observed_name IS NULL AND item_count IS NULL
          AND duplicate_of_entry_id IS NULL AND failure_code IS NULL
          AND failure_retryable IS NULL)
      )
    );

    CREATE TABLE transfers.web_import_acquisition_jobs (
      acquisition_id uuid PRIMARY KEY REFERENCES transfers.web_import_acquisitions (id)
        ON DELETE RESTRICT,
      snapshot_id uuid NOT NULL,
      artifact_reference text NOT NULL UNIQUE CHECK (
        length(artifact_reference) <= 512
        AND artifact_reference ~ '^capture:[0-9a-f-]{36}$'
      ),
      artifact_checksum text NOT NULL CHECK (artifact_checksum ~ '^[a-f0-9]{64}$'),
      artifact_retained_until timestamptz NOT NULL,
      artifact_deleted_at timestamptz,
      inspection_results jsonb CHECK (
        inspection_results IS NULL OR (
          jsonb_typeof(inspection_results) = 'array'
          AND octet_length(inspection_results::text) <= 16777216
        )
      ),
      state text NOT NULL CHECK (state IN (
        'preparing', 'queued', 'leased', 'completed', 'cancelled'
      )),
      available_at timestamptz NOT NULL,
      attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 1000),
      lease_owner text CHECK (length(lease_owner) BETWEEN 1 AND 200),
      lease_generation bigint NOT NULL DEFAULT 0 CHECK (lease_generation >= 0),
      lease_expires_at timestamptz,
      created_at timestamptz NOT NULL,
      updated_at timestamptz NOT NULL,
      completed_at timestamptz,
      CHECK (artifact_retained_until > created_at),
      CHECK (artifact_retained_until <= created_at + interval '15 minutes'),
      CHECK (artifact_deleted_at IS NULL OR artifact_deleted_at >= created_at),
      CHECK (updated_at >= created_at),
      CHECK (available_at >= created_at),
      CHECK (
        (state = 'leased' AND lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL
          AND completed_at IS NULL)
        OR (state IN ('preparing','queued') AND lease_owner IS NULL AND lease_expires_at IS NULL
          AND completed_at IS NULL)
        OR (state IN ('completed','cancelled') AND lease_owner IS NULL
          AND lease_expires_at IS NULL AND completed_at IS NOT NULL)
      )
    );

    CREATE INDEX web_import_acquisitions_owner
      ON transfers.web_import_acquisitions (owner_membership_id, created_at DESC, id DESC);

    CREATE INDEX web_import_acquisitions_owner_processing
      ON transfers.web_import_acquisitions (owner_membership_id)
      WHERE state = 'processing';

    CREATE INDEX web_import_acquisition_jobs_claim
      ON transfers.web_import_acquisition_jobs (available_at, acquisition_id)
      WHERE state IN ('preparing','queued','leased');

    CREATE INDEX web_import_acquisition_jobs_cleanup
      ON transfers.web_import_acquisition_jobs (completed_at, acquisition_id)
      WHERE state IN ('completed','cancelled') AND artifact_deleted_at IS NULL;

    GRANT SELECT, INSERT ON TABLE
      transfers.web_import_acquisitions,
      transfers.web_import_acquisition_items,
      transfers.web_import_acquisition_jobs
    TO place_app;
    GRANT UPDATE (
      state, revision, snapshot_id, ready_count, failed_count, updated_at, completed_at
    )
      ON transfers.web_import_acquisitions TO place_app;
    GRANT UPDATE (
      state, source_list_id, observed_name, item_count, duplicate_of_entry_id,
      failure_code, failure_retryable, updated_at
    ) ON transfers.web_import_acquisition_items TO place_app;
    GRANT UPDATE (
      state, artifact_deleted_at, available_at, attempt_count, lease_owner,
      lease_generation, lease_expires_at, inspection_results, updated_at, completed_at
    ) ON transfers.web_import_acquisition_jobs TO place_app;
  `)
}

export function down(pgm: MigrationBuilder): void {
  pgm.sql(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM transfers.source_snapshots WHERE import_source_kind = 'one-shot'
      ) THEN
        RAISE EXCEPTION 'one-shot snapshots must be migrated before rolling back migration 000050';
      END IF;
    END $$;

    DROP TABLE transfers.web_import_acquisition_jobs;
    DROP TABLE transfers.web_import_acquisition_items;
    DROP TABLE transfers.web_import_acquisitions;

    ALTER TABLE transfers.source_snapshots
      DROP CONSTRAINT source_snapshots_web_acquisition_identity_unique;

    ALTER TABLE library.collection_import_provenance
      DROP CONSTRAINT collection_import_provenance_source_shape_check,
      ADD CONSTRAINT collection_import_provenance_source_shape_check CHECK (
        (import_source_kind = 'verified-connection' AND source_connection_reference IS NOT NULL)
        OR (import_source_kind = 'legacy-reference' AND source_connection_reference IS NULL)
      );

    DROP TRIGGER default_operation_import_source ON transfers.operations;
    DROP FUNCTION transfers.default_operation_import_source();

    ALTER TABLE transfers.operations
      DROP CONSTRAINT operations_verified_import_source_fk,
      DROP CONSTRAINT operations_import_source_fk,
      DROP CONSTRAINT operations_import_source_shape_check,
      DROP CONSTRAINT operations_import_source_kind_check;
    ALTER TABLE transfers.operations
      ADD CONSTRAINT operations_provider_connection_shape_check CHECK (
        (provider_key IS NULL) = (connection_id IS NULL)
      ),
      DROP COLUMN import_source_kind,
      DROP COLUMN import_source_id;

    ALTER TABLE transfers.import_plans
      DROP CONSTRAINT import_plans_contract_major_check,
      ADD CONSTRAINT import_plans_contract_major_check CHECK (contract_major IN (2, 3));
  `)
}
