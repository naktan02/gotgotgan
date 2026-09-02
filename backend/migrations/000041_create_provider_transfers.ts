import type { MigrationBuilder } from 'node-pg-migrate'

export function up(pgm: MigrationBuilder): void {
  pgm.sql(`
    CREATE SCHEMA transfers;
    REVOKE ALL ON SCHEMA transfers FROM PUBLIC;

    CREATE TABLE transfers.provider_connections (
      id uuid PRIMARY KEY,
      owner_membership_id uuid NOT NULL REFERENCES access.memberships (id) ON DELETE RESTRICT,
      provider_key text NOT NULL CHECK (provider_key IN ('naver', 'kakao', 'google')),
      label text NOT NULL CHECK (length(label) BETWEEN 1 AND 120),
      auth_method text NOT NULL CHECK (auth_method IN (
        'browser-session', 'managed-profile', 'oauth', 'account-export', 'manual-file'
      )),
      state text NOT NULL CHECK (state IN ('action-required', 'ready', 'revoked')),
      action_required text CHECK (action_required IN ('complete-authorization', 'reauthorize')),
      revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
      last_verified_at timestamptz,
      created_at timestamptz NOT NULL,
      updated_at timestamptz NOT NULL,
      CHECK (
        (state = 'ready' AND action_required IS NULL AND last_verified_at IS NOT NULL)
        OR (state = 'action-required' AND action_required IS NOT NULL)
        OR (state = 'revoked' AND action_required IS NULL)
      ),
      CHECK (updated_at >= created_at),
      UNIQUE (id, owner_membership_id, provider_key)
    );

    COMMENT ON TABLE transfers.provider_connections IS
      'Credential-free lifecycle projection. Tokens, cookies, secrets, and vault references are forbidden here.';

    CREATE TABLE transfers.connection_observations (
      observation_id uuid PRIMARY KEY,
      connection_id uuid NOT NULL,
      expected_connection_revision bigint NOT NULL CHECK (expected_connection_revision > 0),
      observed_state text NOT NULL CHECK (observed_state IN ('ready', 'action-required')),
      action_required text CHECK (action_required = 'reauthorize'),
      observed_at timestamptz NOT NULL,
      observation_fingerprint text NOT NULL CHECK (observation_fingerprint ~ '^[a-f0-9]{64}$'),
      CHECK (
        (observed_state = 'ready' AND action_required IS NULL)
        OR (observed_state = 'action-required' AND action_required = 'reauthorize')
      ),
      FOREIGN KEY (connection_id) REFERENCES transfers.provider_connections (id)
    );

    CREATE TABLE transfers.source_snapshots (
      id uuid PRIMARY KEY,
      owner_membership_id uuid NOT NULL REFERENCES access.memberships (id) ON DELETE RESTRICT,
      connection_id uuid NOT NULL REFERENCES transfers.provider_connections (id),
      provider_key text NOT NULL CHECK (provider_key IN ('naver', 'kakao', 'google')),
      source_revision text NOT NULL CHECK (length(source_revision) BETWEEN 1 AND 512),
      content_digest text NOT NULL CHECK (content_digest ~ '^[a-f0-9]{64}$'),
      observed_at timestamptz NOT NULL,
      captured_at timestamptz NOT NULL,
      UNIQUE (connection_id, source_revision),
      UNIQUE (id, owner_membership_id),
      FOREIGN KEY (connection_id, owner_membership_id, provider_key)
        REFERENCES transfers.provider_connections (id, owner_membership_id, provider_key),
      CHECK (captured_at >= observed_at)
    );

    CREATE TABLE transfers.source_snapshot_lists (
      snapshot_id uuid NOT NULL REFERENCES transfers.source_snapshots (id),
      source_list_id text NOT NULL CHECK (length(source_list_id) BETWEEN 1 AND 512),
      observed_name text NOT NULL CHECK (length(observed_name) BETWEEN 1 AND 200),
      source_position integer NOT NULL CHECK (source_position >= 0),
      PRIMARY KEY (snapshot_id, source_list_id),
      UNIQUE (snapshot_id, source_position)
    );

    CREATE TABLE transfers.source_snapshot_items (
      snapshot_id uuid NOT NULL,
      source_list_id text NOT NULL,
      source_item_id text NOT NULL CHECK (length(source_item_id) BETWEEN 1 AND 512),
      provider_place_id text CHECK (length(provider_place_id) BETWEEN 1 AND 512),
      observed_name text NOT NULL CHECK (length(observed_name) BETWEEN 1 AND 300),
      observed_address text CHECK (length(observed_address) BETWEEN 1 AND 500),
      observed_category text CHECK (length(observed_category) BETWEEN 1 AND 300),
      observed_location geometry(Point, 4326),
      canonical_place_id uuid REFERENCES places.canonical_places (id),
      match_reason text CHECK (match_reason IN ('missing-identity', 'ambiguous', 'retired')),
      source_position integer NOT NULL CHECK (source_position >= 0),
      PRIMARY KEY (snapshot_id, source_list_id, source_item_id),
      UNIQUE (snapshot_id, source_list_id, source_position),
      FOREIGN KEY (snapshot_id, source_list_id)
        REFERENCES transfers.source_snapshot_lists (snapshot_id, source_list_id),
      CHECK ((canonical_place_id IS NULL) = (match_reason IS NOT NULL))
    );

    COMMENT ON TABLE transfers.source_snapshots IS
      'Immutable provider saved-place observation header; application role has no UPDATE or DELETE grant.';
    COMMENT ON TABLE transfers.source_snapshot_items IS
      'Provider and canonical Place identities only; private notes, ratings, visits, tags, and photos are outside this schema.';

    CREATE TABLE transfers.command_receipts (
      command_id uuid PRIMARY KEY,
      owner_membership_id uuid NOT NULL REFERENCES access.memberships (id) ON DELETE RESTRICT,
      command_kind text NOT NULL CHECK (length(command_kind) BETWEEN 1 AND 80),
      command_fingerprint text NOT NULL CHECK (command_fingerprint ~ '^[a-f0-9]{64}$'),
      status text NOT NULL CHECK (status IN ('pending', 'accepted', 'rejected')),
      result jsonb NOT NULL CHECK (jsonb_typeof(result) = 'object'),
      created_at timestamptz NOT NULL,
      completed_at timestamptz,
      CHECK ((status = 'pending') = (completed_at IS NULL))
    );

    CREATE TABLE transfers.import_plans (
      id uuid PRIMARY KEY,
      owner_membership_id uuid NOT NULL REFERENCES access.memberships (id) ON DELETE RESTRICT,
      snapshot_id uuid NOT NULL,
      snapshot_digest text NOT NULL CHECK (snapshot_digest ~ '^[a-f0-9]{64}$'),
      state text NOT NULL CHECK (state IN ('draft', 'applying', 'completed', 'blocked')),
      revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
      blocked_reason text CHECK (blocked_reason IN ('unresolved-places', 'materialization-rejected')),
      approval_command_id uuid,
      created_at timestamptz NOT NULL,
      updated_at timestamptz NOT NULL,
      FOREIGN KEY (snapshot_id, owner_membership_id)
        REFERENCES transfers.source_snapshots (id, owner_membership_id),
      CHECK ((state = 'blocked') = (blocked_reason IS NOT NULL)),
      CHECK (
        (approval_command_id IS NOT NULL) = (
          state IN ('applying', 'completed')
          OR (state = 'blocked' AND blocked_reason = 'materialization-rejected')
        )
      ),
      CHECK (updated_at >= created_at),
      UNIQUE (id, snapshot_id)
    );

    CREATE TABLE transfers.import_plan_source_lists (
      plan_id uuid NOT NULL,
      snapshot_id uuid NOT NULL,
      source_list_id text NOT NULL,
      PRIMARY KEY (plan_id, source_list_id),
      FOREIGN KEY (plan_id, snapshot_id)
        REFERENCES transfers.import_plans (id, snapshot_id),
      FOREIGN KEY (snapshot_id, source_list_id)
        REFERENCES transfers.source_snapshot_lists (snapshot_id, source_list_id)
    );

    CREATE TABLE transfers.import_plan_mappings (
      plan_id uuid NOT NULL REFERENCES transfers.import_plans (id),
      source_list_id text NOT NULL,
      target_kind text NOT NULL CHECK (target_kind IN ('new', 'existing')),
      target_collection_id uuid NOT NULL,
      target_name text CHECK (length(target_name) BETWEEN 1 AND 120),
      expected_collection_version text CHECK (length(expected_collection_version) BETWEEN 1 AND 512),
      expected_binding_version text CHECK (length(expected_binding_version) BETWEEN 1 AND 512),
      materialization_state text NOT NULL DEFAULT 'pending'
        CHECK (materialization_state IN ('pending', 'applied', 'rejected')),
      materialization_operation_id uuid NOT NULL UNIQUE,
      collection_version text CHECK (length(collection_version) BETWEEN 1 AND 512),
      rejection_code text CHECK (length(rejection_code) BETWEEN 1 AND 120),
      PRIMARY KEY (plan_id, source_list_id),
      FOREIGN KEY (plan_id, source_list_id)
        REFERENCES transfers.import_plan_source_lists (plan_id, source_list_id),
      CHECK (
        (target_kind = 'new' AND target_name IS NOT NULL AND expected_collection_version IS NULL)
        OR (target_kind = 'existing' AND target_name IS NULL AND expected_collection_version IS NOT NULL)
      ),
      CHECK (
        (materialization_state = 'pending' AND collection_version IS NULL AND rejection_code IS NULL)
        OR (materialization_state = 'applied' AND collection_version IS NOT NULL AND rejection_code IS NULL)
        OR (materialization_state = 'rejected' AND collection_version IS NULL AND rejection_code IS NOT NULL)
      )
    );

    CREATE TABLE transfers.import_plan_items (
      plan_id uuid NOT NULL,
      source_list_id text NOT NULL,
      source_item_id text NOT NULL,
      resolved_place_id uuid REFERENCES places.canonical_places (id),
      preview_status text NOT NULL CHECK (preview_status IN (
        'add', 'already-present', 'unresolved', 'skipped'
      )),
      decision_kind text NOT NULL CHECK (decision_kind IN (
        'snapshot-match', 'link', 'skip', 'none'
      )),
      PRIMARY KEY (plan_id, source_list_id, source_item_id),
      FOREIGN KEY (plan_id, source_list_id)
        REFERENCES transfers.import_plan_mappings (plan_id, source_list_id),
      CHECK (
        (preview_status IN ('add', 'already-present') AND resolved_place_id IS NOT NULL
          AND decision_kind IN ('snapshot-match', 'link'))
        OR (preview_status = 'unresolved' AND resolved_place_id IS NULL AND decision_kind = 'none')
        OR (preview_status = 'skipped' AND resolved_place_id IS NULL AND decision_kind = 'skip')
      )
    );

    CREATE TABLE transfers.outbound_transfers (
      id uuid PRIMARY KEY,
      owner_membership_id uuid NOT NULL REFERENCES access.memberships (id) ON DELETE RESTRICT,
      connection_id uuid NOT NULL,
      provider_key text NOT NULL CHECK (provider_key IN ('naver', 'kakao', 'google')),
      collection_id uuid NOT NULL,
      collection_version text NOT NULL CHECK (length(collection_version) BETWEEN 1 AND 512),
      selection_kind text NOT NULL CHECK (selection_kind IN ('all', 'places')),
      plan_digest text NOT NULL CHECK (plan_digest ~ '^[a-f0-9]{64}$'),
      target_kind text NOT NULL CHECK (target_kind IN ('new-list', 'existing-list')),
      target_name text CHECK (length(target_name) BETWEEN 1 AND 120),
      target_list_id text CHECK (length(target_list_id) BETWEEN 1 AND 512),
      target_observation_version text CHECK (length(target_observation_version) BETWEEN 1 AND 512),
      state text NOT NULL CHECK (state IN (
        'draft', 'blocked', 'approved', 'applying', 'completed', 'failed'
      )),
      revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
      blocked_reason text CHECK (blocked_reason IN (
        'target-adapter-unavailable', 'connection-not-ready', 'apply-failed'
      )),
      item_count integer NOT NULL CHECK (item_count >= 0),
      approval_command_id uuid,
      created_at timestamptz NOT NULL,
      updated_at timestamptz NOT NULL,
      CHECK (
        (target_kind = 'new-list' AND target_name IS NOT NULL AND target_list_id IS NULL)
        OR (target_kind = 'existing-list' AND target_name IS NULL AND target_list_id IS NOT NULL)
      ),
      FOREIGN KEY (connection_id, owner_membership_id, provider_key)
        REFERENCES transfers.provider_connections (id, owner_membership_id, provider_key),
      FOREIGN KEY (collection_id, owner_membership_id)
        REFERENCES library.collections (id, owner_membership_id),
      CHECK ((state IN ('blocked', 'failed')) = (blocked_reason IS NOT NULL)),
      CHECK ((state IN ('approved', 'applying', 'completed', 'failed')) = (approval_command_id IS NOT NULL)),
      CHECK (updated_at >= created_at)
    );

    CREATE TABLE transfers.outbound_transfer_items (
      transfer_id uuid NOT NULL REFERENCES transfers.outbound_transfers (id),
      canonical_place_id uuid NOT NULL REFERENCES places.canonical_places (id),
      source_position integer NOT NULL CHECK (source_position >= 0),
      preview_status text NOT NULL CHECK (preview_status IN (
        'add', 'already-present', 'unresolved', 'unsupported', 'unknown'
      )),
      PRIMARY KEY (transfer_id, canonical_place_id),
      UNIQUE (transfer_id, source_position)
    );

    CREATE FUNCTION transfers.guard_import_plan_materialization()
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

    CREATE TRIGGER import_plan_materialization_insert_guard
      BEFORE INSERT ON transfers.import_plan_mappings
      FOR EACH ROW EXECUTE FUNCTION transfers.guard_import_plan_materialization();

    CREATE TRIGGER import_plan_materialization_update_guard
      BEFORE UPDATE OF materialization_state, collection_version, rejection_code
      ON transfers.import_plan_mappings
      FOR EACH ROW EXECUTE FUNCTION transfers.guard_import_plan_materialization();

    CREATE FUNCTION transfers.guard_import_plan_item_decision()
    RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE plan_state text;
    BEGIN
      SELECT state INTO plan_state FROM transfers.import_plans WHERE id = NEW.plan_id;
      IF plan_state <> 'draft' THEN
        RAISE EXCEPTION 'approved import plan items are immutable';
      END IF;
      RETURN NEW;
    END $$;

    CREATE TRIGGER import_plan_item_decision_requires_draft
      BEFORE UPDATE OF resolved_place_id, preview_status, decision_kind
      ON transfers.import_plan_items
      FOR EACH ROW EXECUTE FUNCTION transfers.guard_import_plan_item_decision();

    CREATE INDEX provider_connections_owner
      ON transfers.provider_connections (owner_membership_id, provider_key, created_at, id);
    CREATE INDEX source_snapshots_owner
      ON transfers.source_snapshots (owner_membership_id, captured_at DESC, id DESC);
    CREATE INDEX import_plans_owner
      ON transfers.import_plans (owner_membership_id, updated_at DESC, id);
    CREATE INDEX outbound_transfers_owner
      ON transfers.outbound_transfers (owner_membership_id, updated_at DESC, id);

    GRANT USAGE ON SCHEMA transfers TO place_app;
    GRANT SELECT, INSERT ON TABLE
      transfers.provider_connections,
      transfers.connection_observations,
      transfers.source_snapshots,
      transfers.source_snapshot_lists,
      transfers.source_snapshot_items,
      transfers.command_receipts,
      transfers.import_plans,
      transfers.import_plan_source_lists,
      transfers.import_plan_mappings,
      transfers.import_plan_items,
      transfers.outbound_transfers,
      transfers.outbound_transfer_items
    TO place_app;

    GRANT UPDATE (
      label, state, action_required, revision, last_verified_at, updated_at
    ) ON transfers.provider_connections TO place_app;
    GRANT UPDATE (status, result, completed_at)
      ON transfers.command_receipts TO place_app;
    GRANT UPDATE (
      state, revision, blocked_reason, approval_command_id, updated_at
    ) ON transfers.import_plans TO place_app;
    GRANT UPDATE (
      materialization_state, collection_version, rejection_code
    ) ON transfers.import_plan_mappings TO place_app;
    GRANT UPDATE (resolved_place_id, preview_status, decision_kind)
      ON transfers.import_plan_items TO place_app;
    GRANT UPDATE (
      state, revision, blocked_reason, target_observation_version,
      approval_command_id, updated_at
    ) ON transfers.outbound_transfers TO place_app;
  `)
}

export function down(pgm: MigrationBuilder): void {
  pgm.sql('DROP SCHEMA transfers CASCADE;')
}
