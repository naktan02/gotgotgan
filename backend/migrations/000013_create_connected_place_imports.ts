import type { MigrationBuilder } from 'node-pg-migrate'

export function up(pgm: MigrationBuilder): void {
  pgm.sql(`
    CREATE TABLE ingestion.provider_connections (
      id uuid PRIMARY KEY,
      member_id uuid NOT NULL REFERENCES access.memberships(id),
      provider_key text NOT NULL CHECK (provider_key IN ('naver', 'kakao', 'google')),
      label text NOT NULL CHECK (length(label) BETWEEN 1 AND 120),
      status text NOT NULL CHECK (status IN ('ready', 'action-required', 'revoked')),
      secret_reference text,
      profile_reference text,
      last_verified_at timestamptz,
      created_at timestamptz NOT NULL,
      updated_at timestamptz NOT NULL,
      revoked_at timestamptz,
      CHECK (secret_reference IS NOT NULL OR profile_reference IS NOT NULL),
      CHECK (secret_reference IS NULL OR (
        length(secret_reference) <= 512 AND secret_reference ~ '^[a-z][a-z0-9+.-]{1,31}:[^[:space:]]+$'
      )),
      CHECK (profile_reference IS NULL OR (
        length(profile_reference) <= 512 AND profile_reference ~ '^[a-z][a-z0-9+.-]{1,31}:[^[:space:]]+$'
      )),
      CHECK ((status = 'revoked') = (revoked_at IS NOT NULL)),
      CHECK (updated_at >= created_at)
    );

    CREATE TABLE ingestion.import_batches (
      id uuid PRIMARY KEY,
      member_id uuid NOT NULL REFERENCES access.memberships(id),
      connection_id uuid NOT NULL REFERENCES ingestion.provider_connections(id),
      provider_key text NOT NULL CHECK (provider_key IN ('naver', 'kakao', 'google')),
      idempotency_key uuid NOT NULL,
      request_fingerprint text NOT NULL CHECK (request_fingerprint ~ '^[a-f0-9]{64}$'),
      state text NOT NULL CHECK (state IN (
        'queued', 'running', 'partial', 'needs-user-action',
        'needs-review', 'completed', 'failed', 'cancelled'
      )),
      failure_code text CHECK (failure_code IN (
        'provider-auth-expired', 'provider-mfa-required', 'provider-captcha-required',
        'provider-consent-required', 'provider-rate-limited', 'provider-parser-drift',
        'provider-unavailable', 'capture-invalid', 'internal-failure'
      )),
      failure_retryable boolean,
      discovered_count integer NOT NULL DEFAULT 0 CHECK (discovered_count >= 0),
      ready_count integer NOT NULL DEFAULT 0 CHECK (ready_count >= 0),
      review_required_count integer NOT NULL DEFAULT 0 CHECK (review_required_count >= 0),
      applied_count integer NOT NULL DEFAULT 0 CHECK (applied_count >= 0),
      skipped_count integer NOT NULL DEFAULT 0 CHECK (skipped_count >= 0),
      failed_count integer NOT NULL DEFAULT 0 CHECK (failed_count >= 0),
      cancellation_requested_at timestamptz,
      created_at timestamptz NOT NULL,
      updated_at timestamptz NOT NULL,
      UNIQUE (member_id, idempotency_key),
      CHECK ((failure_code IS NULL) = (failure_retryable IS NULL)),
      CHECK (updated_at >= created_at)
    );

    CREATE TABLE ingestion.import_jobs (
      id uuid PRIMARY KEY,
      batch_id uuid NOT NULL UNIQUE REFERENCES ingestion.import_batches(id),
      state text NOT NULL CHECK (state IN (
        'queued', 'leased', 'waiting', 'action-required', 'completed', 'failed', 'cancelled'
      )),
      cursor text CHECK (length(cursor) BETWEEN 1 AND 2048),
      available_at timestamptz NOT NULL,
      attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
      lease_owner text CHECK (length(lease_owner) BETWEEN 1 AND 200),
      lease_generation bigint NOT NULL DEFAULT 0 CHECK (lease_generation >= 0),
      lease_expires_at timestamptz,
      created_at timestamptz NOT NULL,
      updated_at timestamptz NOT NULL,
      CHECK (
        (state = 'leased' AND lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL)
        OR
        (state <> 'leased' AND lease_owner IS NULL AND lease_expires_at IS NULL)
      ),
      CHECK (updated_at >= created_at)
    );

    CREATE TABLE ingestion.import_attempts (
      job_id uuid NOT NULL REFERENCES ingestion.import_jobs(id),
      generation bigint NOT NULL CHECK (generation > 0),
      worker_reference text NOT NULL CHECK (length(worker_reference) BETWEEN 1 AND 200),
      started_at timestamptz NOT NULL,
      finished_at timestamptz,
      outcome_kind text CHECK (outcome_kind IN (
        'page', 'cancelled', 'needs-user-action', 'failure'
      )),
      outcome_code text,
      retryable boolean,
      PRIMARY KEY (job_id, generation),
      CHECK ((finished_at IS NULL) = (outcome_kind IS NULL)),
      CHECK (finished_at IS NULL OR finished_at >= started_at)
    );

    CREATE TABLE ingestion.import_capture_artifacts (
      id uuid PRIMARY KEY,
      batch_id uuid NOT NULL REFERENCES ingestion.import_batches(id),
      artifact_reference text NOT NULL UNIQUE CHECK (
        length(artifact_reference) <= 512
        AND artifact_reference ~ '^[a-z][a-z0-9+.-]{1,31}:[^[:space:]]+$'
      ),
      payload_checksum text NOT NULL CHECK (payload_checksum ~ '^[a-f0-9]{64}$'),
      parser_version text NOT NULL CHECK (length(parser_version) BETWEEN 1 AND 120),
      acquisition_kind text NOT NULL CHECK (acquisition_kind IN (
        'documented-api', 'account-export', 'structured-web',
        'browser-network', 'browser-dom', 'manual-capture'
      )),
      observed_at timestamptz NOT NULL,
      retained_until timestamptz NOT NULL,
      created_at timestamptz NOT NULL,
      CHECK (retained_until > created_at)
    );

    CREATE TABLE ingestion.import_items (
      id uuid PRIMARY KEY,
      batch_id uuid NOT NULL REFERENCES ingestion.import_batches(id),
      capture_id uuid NOT NULL REFERENCES ingestion.import_capture_artifacts(id),
      source_item_key text NOT NULL CHECK (length(source_item_key) BETWEEN 1 AND 1024),
      provider_place_id text CHECK (length(provider_place_id) BETWEEN 1 AND 512),
      list_name text NOT NULL CHECK (length(list_name) BETWEEN 1 AND 200),
      display_name text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 300),
      address text CHECK (length(address) BETWEEN 1 AND 500),
      category_label text CHECK (length(category_label) BETWEEN 1 AND 300),
      location geometry(Point, 4326),
      status text NOT NULL CHECK (status IN ('ready', 'needs-review', 'applied', 'skipped', 'failed')),
      review_reasons text[] NOT NULL,
      observation_id uuid NOT NULL,
      candidate_id uuid NOT NULL,
      decision_id uuid NOT NULL,
      proposed_place_id uuid NOT NULL,
      canonical_place_id uuid REFERENCES places.canonical_places(id),
      created_at timestamptz NOT NULL,
      updated_at timestamptz NOT NULL,
      UNIQUE (batch_id, source_item_key),
      CHECK (updated_at >= created_at)
    );

    CREATE TABLE ingestion.import_review_receipts (
      command_id uuid PRIMARY KEY,
      member_id uuid NOT NULL REFERENCES access.memberships(id),
      item_id uuid NOT NULL REFERENCES ingestion.import_items(id),
      request_fingerprint text NOT NULL CHECK (request_fingerprint ~ '^[a-f0-9]{64}$'),
      action_kind text NOT NULL CHECK (action_kind IN ('create-place', 'link-place', 'skip')),
      outcome_status text NOT NULL CHECK (outcome_status IN ('pending', 'applied', 'skipped')),
      canonical_place_id uuid REFERENCES places.canonical_places(id),
      created_at timestamptz NOT NULL,
      completed_at timestamptz,
      UNIQUE (item_id),
      CHECK ((outcome_status = 'pending') = (completed_at IS NULL))
    );

    CREATE INDEX provider_connections_member
      ON ingestion.provider_connections (member_id, status, provider_key, id);
    CREATE INDEX import_batches_member
      ON ingestion.import_batches (member_id, created_at DESC, id);
    CREATE INDEX import_jobs_claim
      ON ingestion.import_jobs (available_at, id)
      WHERE state IN ('queued', 'waiting', 'leased');
    CREATE INDEX import_items_batch
      ON ingestion.import_items (batch_id, status, id);
    CREATE INDEX import_items_location_gist
      ON ingestion.import_items USING gist (location)
      WHERE location IS NOT NULL;
    CREATE INDEX import_capture_retention
      ON ingestion.import_capture_artifacts (retained_until, id);

    GRANT SELECT, INSERT, UPDATE ON TABLE
      ingestion.provider_connections,
      ingestion.import_batches,
      ingestion.import_jobs,
      ingestion.import_items
    TO place_app;
    GRANT SELECT, INSERT ON TABLE
      ingestion.import_attempts,
      ingestion.import_capture_artifacts,
      ingestion.import_review_receipts
    TO place_app;
    GRANT UPDATE (finished_at, outcome_kind, outcome_code, retryable)
      ON ingestion.import_attempts TO place_app;
    GRANT UPDATE (outcome_status, canonical_place_id, completed_at)
      ON ingestion.import_review_receipts TO place_app;
  `)
}

export function down(pgm: MigrationBuilder): void {
  pgm.sql(`
    DROP TABLE ingestion.import_review_receipts;
    DROP TABLE ingestion.import_items;
    DROP TABLE ingestion.import_capture_artifacts;
    DROP TABLE ingestion.import_attempts;
    DROP TABLE ingestion.import_jobs;
    DROP TABLE ingestion.import_batches;
    DROP TABLE ingestion.provider_connections;
  `)
}
