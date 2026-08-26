import type { MigrationBuilder } from 'node-pg-migrate'

export function up(pgm: MigrationBuilder): void {
  pgm.sql(`
    ALTER TABLE ingestion.import_batches
      DROP CONSTRAINT import_batches_state_check,
      ADD CONSTRAINT import_batches_state_check CHECK (state IN (
        'queued', 'running', 'partial', 'enriching', 'needs-user-action',
        'needs-review', 'completed', 'failed', 'cancelled'
      )),
      ADD COLUMN enriching_count integer NOT NULL DEFAULT 0 CHECK (enriching_count >= 0);

    ALTER TABLE ingestion.import_items
      DROP CONSTRAINT import_items_status_check,
      ADD CONSTRAINT import_items_status_check CHECK (status IN (
        'enriching', 'ready', 'needs-review', 'applied', 'skipped', 'failed'
      ));

    CREATE TABLE ingestion.import_place_fulfillment_jobs (
      id uuid PRIMARY KEY,
      provider_key text NOT NULL CHECK (provider_key IN ('naver', 'kakao', 'google')),
      provider_place_id text NOT NULL CHECK (length(provider_place_id) BETWEEN 1 AND 512),
      state text NOT NULL CHECK (state IN ('queued', 'leased', 'waiting', 'completed', 'failed')),
      available_at timestamptz NOT NULL,
      attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
      lease_owner text CHECK (length(lease_owner) BETWEEN 1 AND 200),
      lease_generation bigint NOT NULL DEFAULT 0 CHECK (lease_generation >= 0),
      lease_expires_at timestamptz,
      observation_id uuid NOT NULL,
      candidate_id uuid NOT NULL,
      decision_id uuid NOT NULL,
      proposed_place_id uuid NOT NULL,
      completed_canonical_place_id uuid REFERENCES places.canonical_places(id),
      failure_code text CHECK (failure_code IN (
        'provider-rate-limited', 'provider-parser-drift', 'provider-unavailable',
        'capture-invalid', 'internal-failure'
      )),
      failure_retryable boolean,
      created_at timestamptz NOT NULL,
      updated_at timestamptz NOT NULL,
      UNIQUE (provider_key, provider_place_id),
      CHECK (
        (state = 'leased' AND lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL)
        OR
        (state <> 'leased' AND lease_owner IS NULL AND lease_expires_at IS NULL)
      ),
      CHECK ((failure_code IS NULL) = (failure_retryable IS NULL)),
      CHECK (updated_at >= created_at)
    );

    CREATE TABLE ingestion.import_place_fulfillment_intents (
      item_id uuid PRIMARY KEY REFERENCES ingestion.import_items(id),
      job_id uuid NOT NULL REFERENCES ingestion.import_place_fulfillment_jobs(id),
      state text NOT NULL CHECK (state IN ('pending', 'applied', 'needs-review', 'failed', 'cancelled')),
      canonical_place_id uuid REFERENCES places.canonical_places(id),
      created_at timestamptz NOT NULL,
      updated_at timestamptz NOT NULL,
      CHECK (updated_at >= created_at)
    );

    CREATE TABLE ingestion.import_place_fulfillment_attempts (
      job_id uuid NOT NULL REFERENCES ingestion.import_place_fulfillment_jobs(id),
      generation bigint NOT NULL CHECK (generation > 0),
      worker_reference text NOT NULL CHECK (length(worker_reference) BETWEEN 1 AND 200),
      started_at timestamptz NOT NULL,
      finished_at timestamptz,
      outcome_kind text CHECK (outcome_kind IN ('completed', 'needs-review', 'failure')),
      outcome_code text,
      retryable boolean,
      PRIMARY KEY (job_id, generation),
      CHECK ((finished_at IS NULL) = (outcome_kind IS NULL)),
      CHECK (finished_at IS NULL OR finished_at >= started_at)
    );

    CREATE INDEX import_place_fulfillment_claim
      ON ingestion.import_place_fulfillment_jobs (available_at, id)
      WHERE state IN ('queued', 'waiting', 'leased');
    CREATE INDEX import_place_fulfillment_pending
      ON ingestion.import_place_fulfillment_intents (job_id, item_id)
      WHERE state = 'pending';

    GRANT SELECT, INSERT ON TABLE
      ingestion.import_place_fulfillment_jobs,
      ingestion.import_place_fulfillment_intents
    TO place_app;
    GRANT UPDATE (
      state, available_at, attempt_count, lease_owner, lease_generation, lease_expires_at,
      completed_canonical_place_id, failure_code, failure_retryable, updated_at
    ) ON ingestion.import_place_fulfillment_jobs TO place_app;
    GRANT UPDATE (state, canonical_place_id, updated_at)
      ON ingestion.import_place_fulfillment_intents TO place_app;
    GRANT SELECT, INSERT ON TABLE
      ingestion.import_place_fulfillment_attempts
    TO place_app;
    GRANT UPDATE (finished_at, outcome_kind, outcome_code, retryable)
      ON ingestion.import_place_fulfillment_attempts TO place_app;
  `)
}

export function down(pgm: MigrationBuilder): void {
  pgm.sql(`
    UPDATE ingestion.import_items SET status = 'needs-review' WHERE status = 'enriching';
    UPDATE ingestion.import_batches SET state = 'needs-review' WHERE state = 'enriching';

    DROP TABLE ingestion.import_place_fulfillment_attempts;
    DROP TABLE ingestion.import_place_fulfillment_intents;
    DROP TABLE ingestion.import_place_fulfillment_jobs;

    ALTER TABLE ingestion.import_items
      DROP CONSTRAINT import_items_status_check,
      ADD CONSTRAINT import_items_status_check CHECK (
        status IN ('ready', 'needs-review', 'applied', 'skipped', 'failed')
      );

    ALTER TABLE ingestion.import_batches
      DROP COLUMN enriching_count,
      DROP CONSTRAINT import_batches_state_check,
      ADD CONSTRAINT import_batches_state_check CHECK (state IN (
        'queued', 'running', 'partial', 'needs-user-action',
        'needs-review', 'completed', 'failed', 'cancelled'
      ));
  `)
}
