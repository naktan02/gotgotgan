import type { MigrationBuilder } from 'node-pg-migrate'

export function up(pgm: MigrationBuilder): void {
  pgm.sql(`
    ALTER TABLE ingestion.provider_place_detail_observations
      ADD COLUMN previous_source_observation_id uuid,
      ADD COLUMN change_kind text NOT NULL DEFAULT 'initial'
        CHECK (change_kind IN ('initial', 'unchanged', 'changed')),
      ADD CONSTRAINT provider_place_detail_observations_change_shape
        CHECK (
          (change_kind = 'initial') = (previous_source_observation_id IS NULL)
        ),
      ADD CONSTRAINT provider_place_detail_observations_previous_fk
        FOREIGN KEY (
          provider_key, provider_place_id, previous_source_observation_id
        ) REFERENCES ingestion.provider_place_detail_observations (
          provider_key, provider_place_id, source_observation_id
        );

    ALTER TABLE ingestion.provider_place_detail_jobs
      DROP CONSTRAINT provider_place_detail_jobs_provider_key_provider_place_id_key,
      DROP CONSTRAINT provider_place_detail_jobs_failure_code_check,
      ADD CONSTRAINT provider_place_detail_jobs_failure_code_check CHECK (
        failure_code IN (
          'provider-rate-limited', 'provider-unavailable',
          'provider-interaction-required', 'provider-parser-drift', 'capture-invalid'
        )
      );

    CREATE UNIQUE INDEX provider_place_detail_jobs_one_active
      ON ingestion.provider_place_detail_jobs (provider_key, provider_place_id)
      WHERE state IN ('queued', 'waiting', 'leased');

    ALTER TABLE ingestion.provider_place_detail_attempts
      DROP CONSTRAINT provider_place_detail_attempts_outcome_code_check,
      ADD CONSTRAINT provider_place_detail_attempts_outcome_code_check CHECK (
        outcome_code IN (
          'lease-expired', 'provider-rate-limited', 'provider-unavailable',
          'provider-interaction-required', 'provider-parser-drift', 'capture-invalid'
        )
      );

    CREATE INDEX provider_place_detail_statuses_refresh_due
      ON ingestion.provider_place_detail_statuses (
        updated_at, provider_key, provider_place_id
      ) WHERE status = 'available';
  `)
}

export function down(pgm: MigrationBuilder): void {
  pgm.sql(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM ingestion.provider_place_detail_jobs
        WHERE failure_code = 'provider-interaction-required'
      ) OR EXISTS (
        SELECT 1 FROM ingestion.provider_place_detail_attempts
        WHERE outcome_code = 'provider-interaction-required'
      ) THEN
        RAISE EXCEPTION 'cannot remove provider detail refresh while interaction-required outcomes exist';
      END IF;
      IF EXISTS (
        SELECT 1 FROM ingestion.provider_place_detail_jobs
        GROUP BY provider_key, provider_place_id
        HAVING count(*) > 1
      ) THEN
        RAISE EXCEPTION 'cannot restore one provider detail job per identity after refresh history exists';
      END IF;
    END $$;

    DROP INDEX ingestion.provider_place_detail_statuses_refresh_due;

    ALTER TABLE ingestion.provider_place_detail_attempts
      DROP CONSTRAINT provider_place_detail_attempts_outcome_code_check,
      ADD CONSTRAINT provider_place_detail_attempts_outcome_code_check CHECK (
        outcome_code IN (
          'lease-expired', 'provider-rate-limited', 'provider-unavailable',
          'provider-parser-drift', 'capture-invalid'
        )
      );

    DROP INDEX ingestion.provider_place_detail_jobs_one_active;
    ALTER TABLE ingestion.provider_place_detail_jobs
      DROP CONSTRAINT provider_place_detail_jobs_failure_code_check,
      ADD CONSTRAINT provider_place_detail_jobs_failure_code_check CHECK (
        failure_code IN (
          'provider-rate-limited', 'provider-unavailable',
          'provider-parser-drift', 'capture-invalid'
        )
      ),
      ADD CONSTRAINT provider_place_detail_jobs_provider_key_provider_place_id_key
        UNIQUE (provider_key, provider_place_id);

    ALTER TABLE ingestion.provider_place_detail_observations
      DROP CONSTRAINT provider_place_detail_observations_previous_fk,
      DROP CONSTRAINT provider_place_detail_observations_change_shape,
      DROP COLUMN change_kind,
      DROP COLUMN previous_source_observation_id;
  `)
}
