import type { MigrationBuilder } from 'node-pg-migrate'

export function up(pgm: MigrationBuilder): void {
  pgm.sql(`
    ALTER TABLE access.membership_resource_grants
      DROP CONSTRAINT membership_resource_grants_permission_check;
    ALTER TABLE access.membership_resource_grants
      ADD CONSTRAINT membership_resource_grants_permission_check CHECK (permission IN (
        'search.read', 'library.read', 'library.write', 'library.share', 'imports.read',
        'imports.write', 'transfers.read', 'transfers.write', 'review.read', 'review.decide'
      ));

    ALTER TABLE transfers.import_plans
      DROP CONSTRAINT import_plans_state_check,
      DROP CONSTRAINT import_plans_check1;
    ALTER TABLE transfers.import_plans
      ADD CONSTRAINT import_plans_state_check CHECK (
        state IN ('draft', 'applying', 'completed', 'blocked', 'cancelled')
      ),
      ADD CONSTRAINT import_plans_approval_check CHECK (
        (approval_command_id IS NOT NULL) = (
          state IN ('applying', 'completed')
          OR (state = 'blocked' AND blocked_reason = 'materialization-rejected')
          OR state = 'cancelled'
        )
      );

    ALTER TABLE transfers.outbound_transfers
      DROP CONSTRAINT outbound_transfers_state_check,
      DROP CONSTRAINT outbound_transfers_check2;
    ALTER TABLE transfers.outbound_transfers
      ADD CONSTRAINT outbound_transfers_state_check CHECK (
        state IN ('draft', 'blocked', 'approved', 'applying', 'completed', 'failed', 'cancelled')
      ),
      ADD CONSTRAINT outbound_transfers_approval_check CHECK (
        (state IN ('approved', 'applying', 'completed', 'failed', 'cancelled')) =
          (approval_command_id IS NOT NULL)
      );
    ALTER TABLE transfers.outbound_transfer_items
      ADD COLUMN target_provider_place_id text
        CHECK (length(target_provider_place_id) BETWEEN 1 AND 512);
    ALTER TABLE transfers.outbound_transfer_items
      ADD CONSTRAINT outbound_transfer_items_target_provider_place_check CHECK (
        (preview_status IN ('add','already-present') AND target_provider_place_id IS NOT NULL)
        OR (preview_status IN ('unresolved','unsupported','unknown')
          AND target_provider_place_id IS NULL)
      ) NOT VALID;

    CREATE OR REPLACE FUNCTION transfers.guard_import_plan_materialization()
    RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE plan_state text;
    BEGIN
      SELECT state INTO plan_state FROM transfers.import_plans WHERE id = NEW.plan_id;
      IF TG_OP = 'INSERT' AND NEW.materialization_state <> 'pending' THEN
        RAISE EXCEPTION 'new import plan mappings must be pending';
      END IF;
      IF TG_OP = 'UPDATE' THEN
        IF OLD.materialization_state = 'pending' AND NEW.materialization_state = 'pending' THEN
          RAISE EXCEPTION 'pending import materialization may not be rewritten';
        END IF;
        IF OLD.materialization_state = 'applied' THEN
          RAISE EXCEPTION 'applied import materialization is terminal';
        END IF;
        IF OLD.materialization_state = 'rejected' AND NEW.materialization_state <> 'pending' THEN
          RAISE EXCEPTION 'rejected import materialization must resume as pending';
        END IF;
        IF plan_state <> 'applying' THEN
          RAISE EXCEPTION 'import plan materialization requires explicit approval';
        END IF;
      END IF;
      RETURN NEW;
    END $$;

    ALTER TABLE transfers.connection_observations
      ADD COLUMN account_fingerprint text
        CHECK (account_fingerprint ~ '^[a-f0-9]{64}$');

    CREATE TABLE transfers.operations (
      id uuid PRIMARY KEY,
      owner_membership_id uuid NOT NULL REFERENCES access.memberships (id) ON DELETE RESTRICT,
      kind text NOT NULL CHECK (kind IN (
        'import-capture', 'import-materialization', 'outbound-transfer', 'account-erasure'
      )),
      provider_key text CHECK (provider_key IN ('naver', 'kakao', 'google')),
      connection_id uuid,
      account_label text CHECK (length(account_label) BETWEEN 1 AND 120),
      resource_kind text NOT NULL CHECK (resource_kind IN (
        'snapshot', 'import-plan', 'outbound-transfer', 'membership-erasure'
      )),
      resource_id uuid,
      stage text NOT NULL CHECK (stage IN (
        'awaiting-connector', 'receiving-chunks', 'validating-manifest', 'snapshot-recorded',
        'preview-approved', 'queued-for-materialization', 'materializing', 'library-completed',
        'authorizing-execution', 'executing-provider-write', 'reconciling',
        'externally-completed', 'retention-review', 'purging', 'erasure-completed'
      )),
      state text NOT NULL CHECK (state IN (
        'queued', 'running', 'retry-scheduled', 'action-required', 'partial-failure',
        'outcome-unknown', 'completed', 'cancelled', 'failed'
      )),
      revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
      total_count integer NOT NULL DEFAULT 0 CHECK (total_count >= 0),
      processed_count integer NOT NULL DEFAULT 0 CHECK (processed_count >= 0),
      applied_count integer NOT NULL DEFAULT 0 CHECK (applied_count >= 0),
      failed_count integer NOT NULL DEFAULT 0 CHECK (failed_count >= 0),
      outcome_unknown_count integer NOT NULL DEFAULT 0 CHECK (outcome_unknown_count >= 0),
      attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
      next_attempt_at timestamptz,
      lease_owner text CHECK (length(lease_owner) BETWEEN 1 AND 200),
      lease_generation bigint NOT NULL DEFAULT 0 CHECK (lease_generation >= 0),
      lease_expires_at timestamptz,
      action_required text CHECK (action_required IN (
        'reauth-required', 'mfa-required', 'captcha-required', 'consent-required',
        'retention-review-required', 'operator-approval-required'
      )),
      last_error_code text CHECK (length(last_error_code) BETWEEN 1 AND 120),
      last_error_retryable boolean,
      cancel_requested boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL,
      updated_at timestamptz NOT NULL,
      completed_at timestamptz,
      FOREIGN KEY (connection_id, owner_membership_id, provider_key)
        REFERENCES transfers.provider_connections (id, owner_membership_id, provider_key)
        ON DELETE RESTRICT,
      CHECK ((provider_key IS NULL) = (connection_id IS NULL)),
      CHECK (
        (resource_kind = 'membership-erasure' AND resource_id IS NULL)
        OR (resource_kind <> 'membership-erasure' AND resource_id IS NOT NULL)
      ),
      CHECK (
        processed_count <= total_count AND applied_count <= processed_count
        AND failed_count + outcome_unknown_count <= processed_count
        AND applied_count + failed_count + outcome_unknown_count <= processed_count
      ),
      CHECK ((lease_owner IS NULL) = (lease_expires_at IS NULL)),
      CHECK (lease_owner IS NULL OR state = 'running'),
      CHECK ((last_error_code IS NULL) = (last_error_retryable IS NULL)),
      CHECK ((state = 'action-required') = (action_required IS NOT NULL)),
      CHECK ((state IN ('completed', 'cancelled', 'failed')) = (completed_at IS NOT NULL)),
      CHECK (updated_at >= created_at),
      UNIQUE (id, owner_membership_id, provider_key)
    );

    CREATE TABLE transfers.operation_items (
      operation_id uuid NOT NULL REFERENCES transfers.operations (id) ON DELETE RESTRICT,
      item_key text NOT NULL CHECK (length(item_key) BETWEEN 1 AND 512),
      canonical_place_id uuid REFERENCES places.canonical_places (id),
      target_reference text CHECK (length(target_reference) BETWEEN 1 AND 512),
      status text NOT NULL CHECK (status IN (
        'pending', 'applied', 'already-present', 'failed', 'outcome-unknown',
        'present', 'absent', 'skipped'
      )),
      code text CHECK (length(code) BETWEEN 1 AND 120),
      retryable boolean,
      reconciliation_reference text CHECK (length(reconciliation_reference) BETWEEN 1 AND 512),
      source_position integer NOT NULL CHECK (source_position >= 0),
      updated_at timestamptz NOT NULL,
      PRIMARY KEY (operation_id, item_key),
      UNIQUE (operation_id, source_position),
      CHECK (
        (status = 'failed' AND code IS NOT NULL AND retryable IS NOT NULL)
        OR (status = 'outcome-unknown' AND reconciliation_reference IS NOT NULL)
        OR (status NOT IN ('failed', 'outcome-unknown')
          AND code IS NULL AND retryable IS NULL AND reconciliation_reference IS NULL)
      )
    );

    CREATE TABLE transfers.connector_capture_manifests (
      manifest_id uuid PRIMARY KEY,
      operation_id uuid NOT NULL UNIQUE REFERENCES transfers.operations (id) ON DELETE RESTRICT,
      owner_membership_id uuid NOT NULL,
      connection_id uuid NOT NULL,
      provider_key text NOT NULL CHECK (provider_key IN ('naver', 'kakao', 'google')),
      account_fingerprint text NOT NULL CHECK (account_fingerprint ~ '^[a-f0-9]{64}$'),
      installation_id uuid NOT NULL,
      manifest_digest text NOT NULL CHECK (manifest_digest ~ '^[a-f0-9]{64}$'),
      source_revision text NOT NULL CHECK (length(source_revision) BETWEEN 1 AND 512),
      observed_at timestamptz NOT NULL,
      captured_at timestamptz NOT NULL,
      expected_chunk_count integer NOT NULL CHECK (expected_chunk_count BETWEEN 1 AND 1000),
      expected_list_count integer NOT NULL CHECK (expected_list_count BETWEEN 0 AND 10000),
      expected_item_count integer NOT NULL CHECK (expected_item_count BETWEEN 0 AND 100000),
      expected_byte_count integer NOT NULL CHECK (expected_byte_count BETWEEN 2 AND 134217728),
      maximum_chunk_bytes integer NOT NULL CHECK (maximum_chunk_bytes BETWEEN 1024 AND 4194304),
      status text NOT NULL CHECK (status IN ('receiving', 'completed', 'cancelled', 'expired')),
      snapshot_id uuid REFERENCES transfers.source_snapshots (id),
      completed_at timestamptz,
      FOREIGN KEY (operation_id, owner_membership_id, provider_key)
        REFERENCES transfers.operations (id, owner_membership_id, provider_key) ON DELETE RESTRICT,
      FOREIGN KEY (connection_id, owner_membership_id, provider_key)
        REFERENCES transfers.provider_connections (id, owner_membership_id, provider_key)
        ON DELETE RESTRICT,
      CHECK (captured_at >= observed_at),
      CHECK (completed_at IS NULL OR completed_at >= captured_at),
      CHECK ((status = 'completed') = (snapshot_id IS NOT NULL AND completed_at IS NOT NULL)),
      UNIQUE (
        manifest_id, operation_id, owner_membership_id, connection_id, provider_key,
        account_fingerprint, installation_id
      )
    );

    CREATE TABLE transfers.connector_import_grants (
      grant_id uuid PRIMARY KEY,
      command_id uuid NOT NULL UNIQUE,
      operation_id uuid NOT NULL REFERENCES transfers.operations (id) ON DELETE RESTRICT,
      manifest_id uuid NOT NULL REFERENCES transfers.connector_capture_manifests (manifest_id)
        ON DELETE RESTRICT,
      generation integer NOT NULL CHECK (generation > 0),
      owner_membership_id uuid NOT NULL,
      connection_id uuid NOT NULL,
      provider_key text NOT NULL CHECK (provider_key IN ('naver', 'kakao', 'google')),
      account_fingerprint text NOT NULL CHECK (account_fingerprint ~ '^[a-f0-9]{64}$'),
      installation_id uuid NOT NULL,
      request_fingerprint text NOT NULL CHECK (request_fingerprint ~ '^[a-f0-9]{64}$'),
      token_digest text NOT NULL UNIQUE CHECK (token_digest ~ '^[a-f0-9]{64}$'),
      place_origin text NOT NULL CHECK (length(place_origin) BETWEEN 8 AND 2048),
      status text NOT NULL CHECK (status IN ('active', 'revoked', 'expired')),
      issued_at timestamptz NOT NULL,
      expires_at timestamptz NOT NULL,
      FOREIGN KEY (operation_id, owner_membership_id, provider_key)
        REFERENCES transfers.operations (id, owner_membership_id, provider_key)
        ON DELETE RESTRICT,
      FOREIGN KEY (connection_id, owner_membership_id, provider_key)
        REFERENCES transfers.provider_connections (id, owner_membership_id, provider_key)
        ON DELETE RESTRICT,
      FOREIGN KEY (
        manifest_id, operation_id, owner_membership_id, connection_id, provider_key,
        account_fingerprint, installation_id
      )
        REFERENCES transfers.connector_capture_manifests (
          manifest_id, operation_id, owner_membership_id, connection_id, provider_key,
          account_fingerprint, installation_id
        ) ON DELETE RESTRICT,
      CHECK (expires_at > issued_at),
      UNIQUE (operation_id, generation)
    );

    CREATE TABLE transfers.connector_capture_chunks (
      manifest_id uuid NOT NULL REFERENCES transfers.connector_capture_manifests (manifest_id)
        ON DELETE RESTRICT,
      sequence integer NOT NULL CHECK (sequence BETWEEN 0 AND 999),
      item_count integer NOT NULL CHECK (item_count BETWEEN 0 AND 10000),
      byte_count integer NOT NULL CHECK (byte_count BETWEEN 2 AND 4194304),
      checksum text NOT NULL CHECK (checksum ~ '^[a-f0-9]{64}$'),
      payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
      received_at timestamptz NOT NULL,
      PRIMARY KEY (manifest_id, sequence)
    );

    CREATE TABLE transfers.outbound_execution_grants (
      grant_id uuid PRIMARY KEY,
      command_id uuid NOT NULL UNIQUE,
      generation integer NOT NULL CHECK (generation > 0),
      operation_id uuid NOT NULL REFERENCES transfers.operations (id) ON DELETE RESTRICT,
      transfer_id uuid NOT NULL REFERENCES transfers.outbound_transfers (id) ON DELETE RESTRICT,
      owner_membership_id uuid NOT NULL,
      connection_id uuid NOT NULL,
      provider_key text NOT NULL CHECK (provider_key IN ('naver', 'kakao', 'google')),
      account_fingerprint text NOT NULL CHECK (account_fingerprint ~ '^[a-f0-9]{64}$'),
      installation_id uuid NOT NULL,
      plan_digest text NOT NULL CHECK (plan_digest ~ '^[a-f0-9]{64}$'),
      target_kind text NOT NULL CHECK (target_kind IN ('new-list', 'existing-list')),
      target_name text CHECK (length(target_name) BETWEEN 1 AND 120),
      target_list_id text CHECK (length(target_list_id) BETWEEN 1 AND 512),
      token_digest text NOT NULL UNIQUE CHECK (token_digest ~ '^[a-f0-9]{64}$'),
      request_fingerprint text NOT NULL CHECK (request_fingerprint ~ '^[a-f0-9]{64}$'),
      place_origin text NOT NULL CHECK (length(place_origin) BETWEEN 8 AND 2048),
      maximum_items integer NOT NULL CHECK (maximum_items BETWEEN 1 AND 100000),
      maximum_bytes integer NOT NULL CHECK (maximum_bytes BETWEEN 1024 AND 134217728),
      maximum_batches integer NOT NULL CHECK (maximum_batches BETWEEN 1 AND 1000),
      status text NOT NULL CHECK (status IN ('issued', 'consumed', 'revoked', 'expired')),
      receipt_reference uuid UNIQUE,
      receipt_token_digest text UNIQUE CHECK (receipt_token_digest ~ '^[a-f0-9]{64}$'),
      receipt_expires_at timestamptz,
      reconciliation_expires_at timestamptz,
      consumed_item_count integer,
      consumed_byte_count integer,
      consumed_batch_count integer,
      consumed_batch_size integer CHECK (consumed_batch_size BETWEEN 1 AND 500),
      issued_at timestamptz NOT NULL,
      expires_at timestamptz NOT NULL,
      consumed_at timestamptz,
      FOREIGN KEY (operation_id, owner_membership_id, provider_key)
        REFERENCES transfers.operations (id, owner_membership_id, provider_key)
        ON DELETE RESTRICT,
      FOREIGN KEY (connection_id, owner_membership_id, provider_key)
        REFERENCES transfers.provider_connections (id, owner_membership_id, provider_key)
        ON DELETE RESTRICT,
      CHECK (
        (target_kind = 'new-list' AND target_name IS NOT NULL AND target_list_id IS NULL)
        OR (target_kind = 'existing-list' AND target_name IS NULL AND target_list_id IS NOT NULL)
      ),
      CHECK (expires_at > issued_at),
      CHECK (
        (status = 'consumed') = (
          receipt_reference IS NOT NULL AND consumed_item_count IS NOT NULL
          AND receipt_token_digest IS NOT NULL
          AND receipt_expires_at IS NOT NULL
          AND reconciliation_expires_at IS NOT NULL
          AND consumed_byte_count IS NOT NULL AND consumed_batch_count IS NOT NULL
          AND consumed_batch_size IS NOT NULL
          AND consumed_at IS NOT NULL
        )
      ),
      CHECK (
        status <> 'consumed'
        OR (consumed_at < receipt_expires_at
          AND receipt_expires_at <= reconciliation_expires_at)
      ),
      UNIQUE (operation_id, grant_id, receipt_reference),
      UNIQUE (operation_id, receipt_reference),
      UNIQUE (operation_id, generation)
    );

    CREATE TABLE transfers.outbound_execution_attempt_intents (
      attempt_id uuid PRIMARY KEY,
      operation_id uuid NOT NULL,
      grant_id uuid NOT NULL,
      receipt_reference uuid NOT NULL,
      phase text NOT NULL CHECK (phase IN ('create-target-list', 'add-items')),
      target_list_id text CHECK (length(target_list_id) BETWEEN 1 AND 512),
      sequence integer NOT NULL CHECK (sequence BETWEEN 0 AND 999),
      final boolean NOT NULL,
      reconciliation_reference text NOT NULL CHECK (length(reconciliation_reference) BETWEEN 1 AND 512),
      state text NOT NULL CHECK (state IN (
        'prepared','completed','partial','unknown','expired',
        'reconciled-completed','reconciled-partial'
      )),
      request_fingerprint text NOT NULL CHECK (request_fingerprint ~ '^[a-f0-9]{64}$'),
      prepared_at timestamptz NOT NULL,
      FOREIGN KEY (operation_id, grant_id, receipt_reference)
        REFERENCES transfers.outbound_execution_grants (operation_id, grant_id, receipt_reference)
        ON DELETE RESTRICT,
      CHECK (phase = 'create-target-list' OR target_list_id IS NOT NULL),
      UNIQUE (operation_id, phase, sequence),
      UNIQUE (attempt_id, operation_id),
      UNIQUE (attempt_id, operation_id, receipt_reference, phase, reconciliation_reference)
    );

    CREATE TABLE transfers.outbound_execution_attempt_intent_items (
      attempt_id uuid NOT NULL,
      operation_id uuid NOT NULL,
      item_key text NOT NULL CHECK (length(item_key) BETWEEN 1 AND 512),
      target_reference text NOT NULL CHECK (length(target_reference) BETWEEN 1 AND 512),
      PRIMARY KEY (attempt_id, item_key),
      FOREIGN KEY (attempt_id, operation_id)
        REFERENCES transfers.outbound_execution_attempt_intents (attempt_id, operation_id)
        ON DELETE RESTRICT,
      FOREIGN KEY (operation_id, item_key)
        REFERENCES transfers.operation_items (operation_id, item_key) ON DELETE RESTRICT
    );

    CREATE TABLE transfers.outbound_execution_attempts (
      attempt_id uuid PRIMARY KEY,
      operation_id uuid NOT NULL,
      grant_id uuid NOT NULL,
      receipt_reference uuid NOT NULL,
      phase text NOT NULL CHECK (phase IN ('create-target-list', 'add-items')),
      target_list_id text CHECK (length(target_list_id) BETWEEN 1 AND 512),
      sequence integer NOT NULL CHECK (sequence BETWEEN 0 AND 999),
      final boolean NOT NULL,
      outcome text NOT NULL CHECK (outcome IN ('completed', 'partial', 'outcome-unknown')),
      reconciliation_reference text CHECK (length(reconciliation_reference) BETWEEN 1 AND 512),
      problem_code text CHECK (length(problem_code) BETWEEN 1 AND 120),
      problem_retryable boolean,
      problem_action_required text CHECK (problem_action_required IN (
        'reauth-required', 'mfa-required', 'captcha-required', 'consent-required'
      )),
      request_fingerprint text NOT NULL CHECK (request_fingerprint ~ '^[a-f0-9]{64}$'),
      recorded_at timestamptz NOT NULL,
      FOREIGN KEY (operation_id, grant_id, receipt_reference)
        REFERENCES transfers.outbound_execution_grants (operation_id, grant_id, receipt_reference)
        ON DELETE RESTRICT,
      FOREIGN KEY (attempt_id, operation_id)
        REFERENCES transfers.outbound_execution_attempt_intents (attempt_id, operation_id)
        ON DELETE RESTRICT,
      CHECK ((outcome = 'outcome-unknown') = (reconciliation_reference IS NOT NULL))
      ,CHECK ((outcome = 'partial') = (problem_code IS NOT NULL AND problem_retryable IS NOT NULL))
      ,CHECK (problem_action_required IS NULL OR problem_retryable = false)
      ,CHECK (phase = 'create-target-list' OR target_list_id IS NOT NULL)
      ,UNIQUE (attempt_id, operation_id)
    );

    CREATE TABLE transfers.outbound_execution_attempt_items (
      attempt_id uuid NOT NULL,
      operation_id uuid NOT NULL,
      item_key text NOT NULL CHECK (length(item_key) BETWEEN 1 AND 512),
      target_reference text CHECK (length(target_reference) BETWEEN 1 AND 512),
      status text NOT NULL CHECK (status IN (
        'applied', 'already-present', 'failed', 'outcome-unknown'
      )),
      code text CHECK (length(code) BETWEEN 1 AND 120),
      retryable boolean,
      reconciliation_reference text CHECK (length(reconciliation_reference) BETWEEN 1 AND 512),
      PRIMARY KEY (attempt_id, item_key),
      FOREIGN KEY (attempt_id, operation_id)
        REFERENCES transfers.outbound_execution_attempts (attempt_id, operation_id)
        ON DELETE RESTRICT,
      FOREIGN KEY (operation_id, item_key)
        REFERENCES transfers.operation_items (operation_id, item_key) ON DELETE RESTRICT,
      CHECK (
        (status = 'failed' AND code IS NOT NULL AND retryable IS NOT NULL)
        OR (status = 'outcome-unknown' AND reconciliation_reference IS NOT NULL)
        OR (status IN ('applied', 'already-present')
          AND code IS NULL AND retryable IS NULL AND reconciliation_reference IS NULL)
      )
    );

    CREATE TABLE transfers.outbound_reconciliations (
      reconciliation_id uuid PRIMARY KEY,
      observation_sequence bigserial UNIQUE,
      operation_id uuid NOT NULL REFERENCES transfers.operations (id) ON DELETE RESTRICT,
      attempt_id uuid NOT NULL,
      receipt_reference uuid NOT NULL,
      phase text NOT NULL CHECK (phase IN ('create-target-list', 'add-items')),
      target_list_id text CHECK (length(target_list_id) BETWEEN 1 AND 512),
      reconciliation_reference text NOT NULL CHECK (length(reconciliation_reference) BETWEEN 1 AND 512),
      request_fingerprint text NOT NULL CHECK (request_fingerprint ~ '^[a-f0-9]{64}$'),
      outcome text NOT NULL CHECK (outcome IN (
        'resolved-completed', 'resolved-partial', 'still-unknown'
      )),
      recorded_at timestamptz NOT NULL,
      UNIQUE (operation_id, reconciliation_id),
      UNIQUE (reconciliation_id, operation_id, reconciliation_reference),
      FOREIGN KEY (attempt_id, operation_id)
        REFERENCES transfers.outbound_execution_attempt_intents (attempt_id, operation_id)
        ON DELETE RESTRICT,
      FOREIGN KEY (attempt_id, operation_id, receipt_reference, phase, reconciliation_reference)
        REFERENCES transfers.outbound_execution_attempt_intents (
          attempt_id, operation_id, receipt_reference, phase, reconciliation_reference
        ) ON DELETE RESTRICT,
      FOREIGN KEY (operation_id, receipt_reference)
        REFERENCES transfers.outbound_execution_grants (operation_id, receipt_reference)
        ON DELETE RESTRICT,
      CHECK (phase = 'add-items' OR outcome <> 'resolved-partial')
    );

    CREATE TABLE transfers.outbound_reconciliation_items (
      reconciliation_id uuid NOT NULL REFERENCES transfers.outbound_reconciliations (reconciliation_id)
        ON DELETE RESTRICT,
      operation_id uuid NOT NULL,
      reconciliation_reference text NOT NULL,
      item_key text NOT NULL,
      status text NOT NULL CHECK (status IN ('present','absent','unknown')),
      target_reference text CHECK (length(target_reference) BETWEEN 1 AND 512),
      PRIMARY KEY (reconciliation_id, item_key),
      FOREIGN KEY (reconciliation_id, operation_id, reconciliation_reference)
        REFERENCES transfers.outbound_reconciliations (
          reconciliation_id, operation_id, reconciliation_reference
        ) ON DELETE RESTRICT,
      FOREIGN KEY (operation_id, item_key)
        REFERENCES transfers.operation_items (operation_id, item_key) ON DELETE RESTRICT
    );

    CREATE TABLE transfers.retention_holds (
      owner_membership_id uuid NOT NULL REFERENCES access.memberships (id) ON DELETE RESTRICT,
      hold_key text NOT NULL CHECK (length(hold_key) BETWEEN 1 AND 120),
      reason text NOT NULL CHECK (length(reason) BETWEEN 1 AND 500),
      retain_until timestamptz,
      created_at timestamptz NOT NULL,
      PRIMARY KEY (owner_membership_id, hold_key)
    );

    ALTER TABLE transfers.import_plans
      ADD COLUMN operation_id uuid UNIQUE REFERENCES transfers.operations (id) ON DELETE RESTRICT;
    ALTER TABLE transfers.outbound_transfers
      ADD COLUMN operation_id uuid UNIQUE REFERENCES transfers.operations (id) ON DELETE RESTRICT;
    ALTER TABLE transfers.outbound_transfers
      ADD CONSTRAINT outbound_transfer_execution_binding UNIQUE (
        id, owner_membership_id, connection_id, provider_key, plan_digest, operation_id
      );
    ALTER TABLE transfers.outbound_execution_grants
      ADD CONSTRAINT outbound_execution_transfer_binding FOREIGN KEY (
        transfer_id, owner_membership_id, connection_id, provider_key, plan_digest, operation_id
      ) REFERENCES transfers.outbound_transfers (
        id, owner_membership_id, connection_id, provider_key, plan_digest, operation_id
      ) ON DELETE RESTRICT;
    ALTER TABLE transfers.source_snapshots
      ADD CONSTRAINT source_snapshot_capture_binding UNIQUE (
        id, owner_membership_id, connection_id, provider_key
      );
    ALTER TABLE transfers.connector_capture_manifests
      ADD CONSTRAINT capture_manifest_snapshot_binding FOREIGN KEY (
        snapshot_id, owner_membership_id, connection_id, provider_key
      ) REFERENCES transfers.source_snapshots (
        id, owner_membership_id, connection_id, provider_key
      ) ON DELETE RESTRICT;

    CREATE FUNCTION transfers.assert_operation_resource_binding()
    RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.resource_kind = 'snapshot' AND NOT EXISTS (
        SELECT 1 FROM transfers.connector_capture_manifests AS manifest
        WHERE manifest.manifest_id = NEW.resource_id AND manifest.operation_id = NEW.id
          AND manifest.owner_membership_id = NEW.owner_membership_id
          AND NEW.kind = 'import-capture' AND manifest.provider_key = NEW.provider_key
          AND manifest.connection_id = NEW.connection_id
      ) THEN RAISE EXCEPTION 'snapshot operation resource binding is invalid'; END IF;
      IF NEW.resource_kind = 'import-plan' AND NOT EXISTS (
        SELECT 1 FROM transfers.import_plans AS plan
        JOIN transfers.source_snapshots AS snapshot ON snapshot.id = plan.snapshot_id
        WHERE plan.id = NEW.resource_id AND plan.operation_id = NEW.id
          AND plan.owner_membership_id = NEW.owner_membership_id
          AND NEW.kind = 'import-materialization' AND snapshot.provider_key = NEW.provider_key
          AND snapshot.connection_id = NEW.connection_id
      ) THEN RAISE EXCEPTION 'import operation resource binding is invalid'; END IF;
      IF NEW.resource_kind = 'outbound-transfer' AND NOT EXISTS (
        SELECT 1 FROM transfers.outbound_transfers AS transfer
        WHERE transfer.id = NEW.resource_id AND transfer.operation_id = NEW.id
          AND transfer.owner_membership_id = NEW.owner_membership_id
          AND NEW.kind = 'outbound-transfer' AND transfer.provider_key = NEW.provider_key
          AND transfer.connection_id = NEW.connection_id
      ) THEN RAISE EXCEPTION 'outbound operation resource binding is invalid'; END IF;
      IF NEW.resource_kind = 'membership-erasure' AND NEW.kind <> 'account-erasure' THEN
        RAISE EXCEPTION 'membership erasure operation kind is invalid';
      END IF;
      RETURN NEW;
    END $$;
    CREATE CONSTRAINT TRIGGER transfer_operation_resource_binding
      AFTER INSERT OR UPDATE OF resource_kind, resource_id, owner_membership_id, kind,
        provider_key, connection_id
      ON transfers.operations DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION transfers.assert_operation_resource_binding();

    CREATE FUNCTION transfers.assert_resource_operation_binding()
    RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE row_data jsonb;
    BEGIN
      row_data := to_jsonb(NEW);
      IF TG_TABLE_NAME = 'connector_capture_manifests' AND NOT EXISTS (
        SELECT 1 FROM transfers.operations AS operation
        WHERE operation.id = (row_data->>'operation_id')::uuid
          AND operation.resource_kind = 'snapshot'
          AND operation.resource_id = (row_data->>'manifest_id')::uuid
          AND operation.kind = 'import-capture'
          AND operation.owner_membership_id = (row_data->>'owner_membership_id')::uuid
          AND operation.provider_key = row_data->>'provider_key'
          AND operation.connection_id = (row_data->>'connection_id')::uuid
      ) THEN RAISE EXCEPTION 'capture resource operation binding is invalid'; END IF;
      IF TG_TABLE_NAME = 'import_plans' AND row_data->>'operation_id' IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM transfers.operations AS operation
        JOIN transfers.source_snapshots AS snapshot
          ON snapshot.id = (row_data->>'snapshot_id')::uuid
        WHERE operation.id = (row_data->>'operation_id')::uuid
          AND operation.resource_kind = 'import-plan'
          AND operation.resource_id = (row_data->>'id')::uuid
          AND operation.kind = 'import-materialization'
          AND operation.owner_membership_id = (row_data->>'owner_membership_id')::uuid
          AND operation.provider_key = snapshot.provider_key
          AND operation.connection_id = snapshot.connection_id
      ) THEN RAISE EXCEPTION 'import resource operation binding is invalid'; END IF;
      IF TG_TABLE_NAME = 'outbound_transfers' AND row_data->>'operation_id' IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM transfers.operations AS operation
        WHERE operation.id = (row_data->>'operation_id')::uuid
          AND operation.resource_kind = 'outbound-transfer'
          AND operation.resource_id = (row_data->>'id')::uuid
          AND operation.kind = 'outbound-transfer'
          AND operation.owner_membership_id = (row_data->>'owner_membership_id')::uuid
          AND operation.provider_key = row_data->>'provider_key'
          AND operation.connection_id = (row_data->>'connection_id')::uuid
      ) THEN RAISE EXCEPTION 'outbound resource operation binding is invalid'; END IF;
      RETURN NEW;
    END $$;
    CREATE CONSTRAINT TRIGGER capture_resource_operation_binding
      AFTER INSERT OR UPDATE
      ON transfers.connector_capture_manifests DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION transfers.assert_resource_operation_binding();
    CREATE CONSTRAINT TRIGGER import_resource_operation_binding
      AFTER INSERT OR UPDATE
      ON transfers.import_plans DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION transfers.assert_resource_operation_binding();
    CREATE CONSTRAINT TRIGGER outbound_resource_operation_binding
      AFTER INSERT OR UPDATE
      ON transfers.outbound_transfers DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION transfers.assert_resource_operation_binding();

    CREATE INDEX transfer_operations_owner_updated
      ON transfers.operations (owner_membership_id, updated_at DESC, id DESC);
    CREATE INDEX transfer_operations_claim
      ON transfers.operations (state, next_attempt_at, created_at, id)
      WHERE state IN ('queued', 'retry-scheduled', 'running');
    CREATE INDEX transfer_operation_items_page
      ON transfers.operation_items (operation_id, source_position, item_key);

    COMMENT ON TABLE ingestion.connector_import_operations IS
      'Legacy v1 connector acquisition ledger. Production v1 grants are deprecated and cannot authorize Transfers materialization.';
    COMMENT ON TABLE transfers.connector_capture_chunks IS
      'Immutable normalized observation chunks; credentials and personal annotations are forbidden.';
    COMMENT ON TABLE transfers.outbound_execution_grants IS
      'One-time execution claims; only a SHA-256 token digest is persisted.';

    GRANT SELECT, INSERT ON TABLE
      transfers.operations,
      transfers.operation_items,
      transfers.connector_capture_manifests,
      transfers.connector_import_grants,
      transfers.connector_capture_chunks,
      transfers.outbound_execution_grants,
      transfers.outbound_execution_attempt_intents,
      transfers.outbound_execution_attempt_intent_items,
      transfers.outbound_execution_attempts,
      transfers.outbound_execution_attempt_items,
      transfers.outbound_reconciliations,
      transfers.outbound_reconciliation_items
    TO place_app;
    GRANT UPDATE (
      stage, state, revision, total_count, processed_count, applied_count, failed_count,
      outcome_unknown_count, attempt_count, next_attempt_at, lease_owner, lease_expires_at,
      lease_generation,
      action_required, last_error_code, last_error_retryable, cancel_requested,
      updated_at, completed_at
    ) ON transfers.operations TO place_app;
    GRANT UPDATE (status) ON transfers.connector_import_grants TO place_app;
    GRANT UPDATE (status, snapshot_id, completed_at)
      ON transfers.connector_capture_manifests TO place_app;
    GRANT UPDATE (
      status, receipt_reference, consumed_item_count, consumed_byte_count,
      consumed_batch_count, consumed_batch_size, consumed_at, receipt_token_digest
      ,receipt_expires_at, reconciliation_expires_at
    ) ON transfers.outbound_execution_grants TO place_app;
    GRANT UPDATE (
      status, target_reference, code, retryable, reconciliation_reference, updated_at
    ) ON transfers.operation_items TO place_app;
    GRANT UPDATE (state, target_list_id)
      ON transfers.outbound_execution_attempt_intents TO place_app;
    GRANT USAGE, SELECT ON SEQUENCE
      transfers.outbound_reconciliations_observation_sequence_seq TO place_app;
    GRANT UPDATE (operation_id) ON transfers.import_plans TO place_app;
    GRANT UPDATE (operation_id) ON transfers.outbound_transfers TO place_app;
  `)
}

export function down(pgm: MigrationBuilder): void {
  pgm.sql(`
    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM access.membership_resource_grants
        WHERE permission IN (
          'search.read','imports.read','imports.write','transfers.read','transfers.write'
        )) THEN
        RAISE EXCEPTION 'post-000041 grants must be removed before rolling back migration 000042';
      END IF;
      IF EXISTS (SELECT 1 FROM transfers.import_plans WHERE state = 'cancelled')
        OR EXISTS (SELECT 1 FROM transfers.outbound_transfers WHERE state = 'cancelled') THEN
        RAISE EXCEPTION 'cancelled transfer records must be migrated before rolling back migration 000042';
      END IF;
    END $$;
    ALTER TABLE access.membership_resource_grants
      DROP CONSTRAINT membership_resource_grants_permission_check;
    ALTER TABLE access.membership_resource_grants
      ADD CONSTRAINT membership_resource_grants_permission_check CHECK (permission IN (
        'library.read','library.write','library.share','review.read','review.decide'
      ));
    ALTER TABLE transfers.outbound_transfer_items
      DROP CONSTRAINT outbound_transfer_items_target_provider_place_check,
      DROP COLUMN target_provider_place_id;
    ALTER TABLE transfers.outbound_transfers
      DROP CONSTRAINT outbound_transfers_state_check,
      DROP CONSTRAINT outbound_transfers_approval_check;
    ALTER TABLE transfers.outbound_transfers
      ADD CONSTRAINT outbound_transfers_state_check CHECK (
        state IN ('draft', 'blocked', 'approved', 'applying', 'completed', 'failed')
      ),
      ADD CONSTRAINT outbound_transfers_check2 CHECK (
        (state IN ('approved', 'applying', 'completed', 'failed')) =
          (approval_command_id IS NOT NULL)
      );
    ALTER TABLE transfers.import_plans
      DROP CONSTRAINT import_plans_state_check,
      DROP CONSTRAINT import_plans_approval_check;
    ALTER TABLE transfers.import_plans
      ADD CONSTRAINT import_plans_state_check CHECK (
        state IN ('draft', 'applying', 'completed', 'blocked')
      ),
      ADD CONSTRAINT import_plans_check1 CHECK (
        (approval_command_id IS NOT NULL) = (
          state IN ('applying', 'completed')
          OR (state = 'blocked' AND blocked_reason = 'materialization-rejected')
        )
      );
    CREATE OR REPLACE FUNCTION transfers.guard_import_plan_materialization()
    RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE plan_state text;
    BEGIN
      SELECT state INTO plan_state FROM transfers.import_plans WHERE id = NEW.plan_id;
      IF TG_OP = 'INSERT' AND NEW.materialization_state <> 'pending' THEN
        RAISE EXCEPTION 'new import plan mappings must be pending';
      END IF;
      IF TG_OP = 'UPDATE' THEN
        IF OLD.materialization_state <> 'pending' OR NEW.materialization_state = 'pending' THEN
          RAISE EXCEPTION 'import materialization outcome is terminal';
        END IF;
        IF plan_state <> 'applying' THEN
          RAISE EXCEPTION 'import plan materialization requires explicit approval';
        END IF;
      END IF;
      RETURN NEW;
    END $$;
    ALTER TABLE transfers.outbound_execution_grants DROP CONSTRAINT outbound_execution_transfer_binding;
    ALTER TABLE transfers.connector_capture_manifests DROP CONSTRAINT capture_manifest_snapshot_binding;
    ALTER TABLE transfers.source_snapshots DROP CONSTRAINT source_snapshot_capture_binding;
    DROP FUNCTION transfers.assert_resource_operation_binding CASCADE;
    DROP FUNCTION transfers.assert_operation_resource_binding CASCADE;
    ALTER TABLE transfers.outbound_transfers DROP CONSTRAINT outbound_transfer_execution_binding;
    ALTER TABLE transfers.outbound_transfers DROP COLUMN operation_id;
    ALTER TABLE transfers.import_plans DROP COLUMN operation_id;
    DROP TABLE transfers.retention_holds;
    DROP TABLE transfers.outbound_reconciliation_items;
    DROP TABLE transfers.outbound_reconciliations;
    DROP TABLE transfers.outbound_execution_attempt_items;
    DROP TABLE transfers.outbound_execution_attempts;
    DROP TABLE transfers.outbound_execution_attempt_intent_items;
    DROP TABLE transfers.outbound_execution_attempt_intents;
    DROP TABLE transfers.outbound_execution_grants;
    DROP TABLE transfers.connector_capture_chunks;
    DROP TABLE transfers.connector_import_grants;
    DROP TABLE transfers.connector_capture_manifests;
    DROP TABLE transfers.operation_items;
    DROP TABLE transfers.operations;
    ALTER TABLE transfers.connection_observations DROP COLUMN account_fingerprint;
  `)
}
