import type { MigrationBuilder } from 'node-pg-migrate'

export function up(pgm: MigrationBuilder): void {
  pgm.sql(`
    CREATE SCHEMA resolution;
    REVOKE ALL ON SCHEMA resolution FROM PUBLIC;

    CREATE TABLE resolution.place_evidence_index (
      provider_key text NOT NULL CHECK (provider_key ~ '^[a-z][a-z0-9-]{0,62}$'),
      external_place_id text NOT NULL CHECK (length(external_place_id) BETWEEN 1 AND 512),
      source_observation_id uuid NOT NULL UNIQUE
        REFERENCES ingestion.source_observations (id),
      observed_at timestamptz NOT NULL,
      names jsonb NOT NULL CHECK (
        jsonb_typeof(names) = 'array' AND jsonb_array_length(names) BETWEEN 1 AND 16
      ),
      normalized_name_search text NOT NULL CHECK (normalized_name_search <> ''),
      address text,
      normalized_address text,
      phone text,
      phone_digits text,
      website text,
      website_host text,
      category_label text,
      category_key text,
      branch_label text,
      branch_key text,
      floor_label text,
      floor_key text,
      location geography(Point, 4326),
      evidence_fingerprint text NOT NULL CHECK (evidence_fingerprint ~ '^[a-f0-9]{64}$'),
      indexed_at timestamptz NOT NULL,
      PRIMARY KEY (provider_key, external_place_id)
    );

    COMMENT ON TABLE resolution.place_evidence_index IS
      'Replaceable current evidence representations used only to find cross-provider match candidates.';

    CREATE INDEX place_evidence_name_trgm
      ON resolution.place_evidence_index USING gin (normalized_name_search gin_trgm_ops);
    CREATE INDEX place_evidence_address_trgm
      ON resolution.place_evidence_index USING gin (normalized_address gin_trgm_ops)
      WHERE normalized_address IS NOT NULL;
    CREATE INDEX place_evidence_location_gist
      ON resolution.place_evidence_index USING gist (location)
      WHERE location IS NOT NULL;
    CREATE INDEX place_evidence_phone
      ON resolution.place_evidence_index (phone_digits)
      WHERE phone_digits IS NOT NULL;
    CREATE INDEX place_evidence_website_host
      ON resolution.place_evidence_index (website_host)
      WHERE website_host IS NOT NULL;

    CREATE TABLE resolution.match_assessments (
      left_observation_id uuid NOT NULL REFERENCES ingestion.source_observations (id),
      right_observation_id uuid NOT NULL REFERENCES ingestion.source_observations (id),
      left_identity jsonb NOT NULL,
      right_identity jsonb NOT NULL,
      policy_version text NOT NULL CHECK (policy_version <> ''),
      classification text NOT NULL CHECK (
        classification IN ('likely-same', 'needs-review', 'likely-different')
      ),
      confidence numeric(4, 3) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
      features jsonb NOT NULL CHECK (jsonb_typeof(features) = 'object'),
      reasons text[] NOT NULL CHECK (cardinality(reasons) > 0),
      assessed_at timestamptz NOT NULL,
      fingerprint text NOT NULL CHECK (fingerprint ~ '^[a-f0-9]{64}$'),
      PRIMARY KEY (left_observation_id, right_observation_id, policy_version),
      CHECK (left_observation_id < right_observation_id)
    );

    COMMENT ON TABLE resolution.match_assessments IS
      'Immutable versioned comparison evidence; never a canonical Place mutation or resolution decision.';

    CREATE INDEX match_assessments_classification
      ON resolution.match_assessments (classification, assessed_at, left_observation_id);

    GRANT USAGE ON SCHEMA resolution TO place_app;
    GRANT SELECT, INSERT ON TABLE
      resolution.place_evidence_index,
      resolution.match_assessments
    TO place_app;
    GRANT UPDATE (
      source_observation_id, observed_at, names, normalized_name_search,
      address, normalized_address, phone, phone_digits, website, website_host,
      category_label, category_key, branch_label, branch_key, floor_label, floor_key,
      location, evidence_fingerprint, indexed_at
    ) ON resolution.place_evidence_index TO place_app;
  `)
}

export function down(pgm: MigrationBuilder): void {
  pgm.sql('DROP SCHEMA resolution CASCADE;')
}
