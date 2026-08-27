import type { MigrationBuilder } from 'node-pg-migrate'

export function up(pgm: MigrationBuilder): void {
  pgm.sql(`
    ALTER TABLE ingestion.provider_place_detail_statuses
      DROP CONSTRAINT provider_place_detail_statuses_status_check,
      ADD CONSTRAINT provider_place_detail_statuses_status_check
        CHECK (status IN ('pending', 'available', 'unavailable'));

    CREATE TABLE ingestion.provider_place_detail_jobs (
      id uuid PRIMARY KEY,
      provider_key text NOT NULL CHECK (provider_key IN ('naver', 'kakao', 'google')),
      provider_place_id text NOT NULL CHECK (length(provider_place_id) BETWEEN 1 AND 512),
      state text NOT NULL CHECK (state IN ('queued', 'waiting', 'leased', 'completed', 'failed')),
      available_at timestamptz NOT NULL,
      attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
      observation_id uuid NOT NULL UNIQUE,
      candidate_id uuid NOT NULL UNIQUE,
      failure_code text CHECK (failure_code IN (
        'provider-rate-limited', 'provider-unavailable',
        'provider-parser-drift', 'capture-invalid'
      )),
      failure_retryable boolean,
      lease_owner text,
      lease_generation integer NOT NULL DEFAULT 0 CHECK (lease_generation >= 0),
      lease_expires_at timestamptz,
      completed_at timestamptz,
      created_at timestamptz NOT NULL,
      updated_at timestamptz NOT NULL,
      UNIQUE (provider_key, provider_place_id),
      FOREIGN KEY (provider_key, provider_place_id)
        REFERENCES ingestion.provider_place_detail_statuses (provider_key, provider_place_id),
      CHECK (
        (state = 'leased') =
        (lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL)
      ),
      CHECK ((failure_code IS NULL) = (failure_retryable IS NULL)),
      CHECK ((state = 'completed') = (completed_at IS NOT NULL)),
      CHECK (updated_at >= created_at)
    );

    CREATE INDEX provider_place_detail_jobs_claim
      ON ingestion.provider_place_detail_jobs (available_at, id)
      WHERE state IN ('queued', 'waiting', 'leased');

    CREATE TABLE ingestion.provider_place_detail_attempts (
      job_id uuid NOT NULL REFERENCES ingestion.provider_place_detail_jobs(id),
      generation integer NOT NULL CHECK (generation > 0),
      worker_reference text NOT NULL CHECK (length(worker_reference) BETWEEN 1 AND 512),
      started_at timestamptz NOT NULL,
      finished_at timestamptz,
      outcome_kind text CHECK (outcome_kind IN ('completed', 'failure')),
      outcome_code text CHECK (outcome_code IN (
        'lease-expired', 'provider-rate-limited', 'provider-unavailable',
        'provider-parser-drift', 'capture-invalid'
      )),
      retryable boolean,
      PRIMARY KEY (job_id, generation),
      CHECK ((finished_at IS NULL) = (outcome_kind IS NULL)),
      CHECK (finished_at IS NULL OR finished_at >= started_at),
      CHECK (outcome_kind = 'failure' OR outcome_code IS NULL),
      CHECK ((outcome_code IS NULL) = (retryable IS NULL))
    );

    INSERT INTO ingestion.provider_place_detail_jobs (
      id, provider_key, provider_place_id, state, available_at,
      observation_id, candidate_id, created_at, updated_at
    )
    SELECT gen_random_uuid(), status.provider_key, status.provider_place_id,
           'queued', status.requested_at, gen_random_uuid(), gen_random_uuid(),
           status.requested_at, status.updated_at
    FROM ingestion.provider_place_detail_statuses AS status
    WHERE status.status = 'pending';

    GRANT SELECT, INSERT ON TABLE ingestion.provider_place_detail_jobs TO place_app;
    GRANT UPDATE (
      state, available_at, attempt_count, failure_code, failure_retryable,
      lease_owner, lease_generation, lease_expires_at, completed_at, updated_at
    ) ON ingestion.provider_place_detail_jobs TO place_app;
    GRANT SELECT, INSERT ON TABLE ingestion.provider_place_detail_attempts TO place_app;
    GRANT UPDATE (
      finished_at, outcome_kind, outcome_code, retryable
    ) ON ingestion.provider_place_detail_attempts TO place_app;
    GRANT UPDATE (status, last_detail_observation_id, updated_at)
      ON ingestion.provider_place_detail_statuses TO place_app;
  `)
}

export function down(pgm: MigrationBuilder): void {
  pgm.sql(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM ingestion.provider_place_detail_statuses
        WHERE status = 'unavailable'
      ) THEN
        RAISE EXCEPTION 'cannot remove provider detail jobs while unavailable states exist';
      END IF;
    END $$;

    DROP TABLE ingestion.provider_place_detail_attempts;
    DROP TABLE ingestion.provider_place_detail_jobs;
    ALTER TABLE ingestion.provider_place_detail_statuses
      DROP CONSTRAINT provider_place_detail_statuses_status_check,
      ADD CONSTRAINT provider_place_detail_statuses_status_check
        CHECK (status IN ('pending', 'available'));
  `)
}
