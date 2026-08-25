import type { MigrationBuilder } from 'node-pg-migrate'

export function up(pgm: MigrationBuilder): void {
  pgm.sql(`
    CREATE SCHEMA ingestion;
    REVOKE ALL ON SCHEMA ingestion FROM PUBLIC;

    CREATE TABLE ingestion.source_observations (
      id uuid PRIMARY KEY,
      provider_key text NOT NULL CHECK (provider_key ~ '^[a-z][a-z0-9-]{0,62}$'),
      external_place_id text NOT NULL CHECK (external_place_id <> ''),
      acquisition_kind text NOT NULL CHECK (
        acquisition_kind IN (
          'documented-api', 'account-export', 'structured-web',
          'browser-network', 'browser-dom', 'manual-capture'
        )
      ),
      payload_checksum text NOT NULL CHECK (payload_checksum ~ '^[a-f0-9]{64}$'),
      parser_version text NOT NULL CHECK (parser_version <> ''),
      observed_at timestamptz NOT NULL,
      acquired_at timestamptz NOT NULL,
      capture_reference text,
      facts jsonb NOT NULL,
      confidence numeric(4, 3) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
      fingerprint text NOT NULL CHECK (fingerprint ~ '^[a-f0-9]{64}$'),
      created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    COMMENT ON TABLE ingestion.source_observations IS
      'Immutable, provider-specific evidence; never a canonical overwrite command.';

    CREATE TABLE ingestion.place_candidates (
      id uuid PRIMARY KEY,
      source_observation_id uuid NOT NULL
        REFERENCES ingestion.source_observations (id),
      parser_version text NOT NULL CHECK (parser_version <> ''),
      name text NOT NULL CHECK (name <> ''),
      address text,
      location geography(Point, 4326),
      attributes jsonb NOT NULL,
      fingerprint text NOT NULL CHECK (fingerprint ~ '^[a-f0-9]{64}$'),
      created_at timestamptz NOT NULL,
      UNIQUE (source_observation_id, parser_version)
    );

    CREATE INDEX place_candidates_location_gist
      ON ingestion.place_candidates USING gist (location)
      WHERE location IS NOT NULL;

    CREATE TABLE ingestion.resolution_decisions (
      id uuid PRIMARY KEY,
      candidate_id uuid REFERENCES ingestion.place_candidates (id),
      decision_kind text NOT NULL CHECK (
        decision_kind IN (
          'needs-review', 'explicit-not-same', 'create-place', 'link-place',
          'merge-places', 'split-provider-identity', 'retire-place'
        )
      ),
      decision jsonb NOT NULL,
      decided_by_kind text NOT NULL CHECK (decided_by_kind IN ('policy', 'reviewer')),
      decided_by_reference text NOT NULL CHECK (decided_by_reference <> ''),
      evidence_observation_ids uuid[] NOT NULL CHECK (cardinality(evidence_observation_ids) > 0),
      rationale text NOT NULL CHECK (rationale <> ''),
      fingerprint text NOT NULL CHECK (fingerprint ~ '^[a-f0-9]{64}$'),
      decided_at timestamptz NOT NULL,
      CHECK (decision_kind = decision ->> 'kind'),
      CHECK (
        (decision_kind IN ('needs-review', 'explicit-not-same', 'create-place', 'link-place')
          AND candidate_id IS NOT NULL)
        OR (decision_kind IN ('merge-places', 'split-provider-identity', 'retire-place'))
      )
    );

    GRANT USAGE ON SCHEMA ingestion TO place_app;
    GRANT SELECT, INSERT ON TABLE
      ingestion.source_observations,
      ingestion.place_candidates,
      ingestion.resolution_decisions
    TO place_app;
  `)
}

export function down(pgm: MigrationBuilder): void {
  pgm.sql('DROP SCHEMA ingestion CASCADE;')
}
