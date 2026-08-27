import type { MigrationBuilder } from 'node-pg-migrate'

export function up(pgm: MigrationBuilder): void {
  pgm.sql(`
    CREATE TABLE resolution.place_cluster_proposals (
      proposal_id uuid NOT NULL,
      proposal_version integer NOT NULL CHECK (proposal_version > 0),
      cluster_policy_version text NOT NULL CHECK (cluster_policy_version <> ''),
      mode text NOT NULL CHECK (mode = 'shadow'),
      member_count integer NOT NULL CHECK (member_count > 0),
      proposed_at timestamptz NOT NULL,
      fingerprint text NOT NULL UNIQUE CHECK (fingerprint ~ '^[a-f0-9]{64}$'),
      PRIMARY KEY (proposal_id, proposal_version)
    );

    COMMENT ON TABLE resolution.place_cluster_proposals IS
      'Immutable non-canonical cluster proposals; rows never authorize a Place link or merge.';

    CREATE TABLE resolution.place_cluster_members (
      proposal_id uuid NOT NULL,
      proposal_version integer NOT NULL,
      member_ordinal integer NOT NULL CHECK (member_ordinal >= 0),
      source_observation_id uuid NOT NULL REFERENCES ingestion.source_observations (id),
      provider_key text NOT NULL CHECK (provider_key ~ '^[a-z][a-z0-9-]{0,62}$'),
      external_place_id text NOT NULL CHECK (length(external_place_id) BETWEEN 1 AND 512),
      PRIMARY KEY (proposal_id, proposal_version, source_observation_id),
      UNIQUE (proposal_id, proposal_version, member_ordinal),
      UNIQUE (proposal_id, proposal_version, provider_key, external_place_id),
      FOREIGN KEY (proposal_id, proposal_version)
        REFERENCES resolution.place_cluster_proposals (proposal_id, proposal_version)
    );

    CREATE INDEX place_cluster_members_provider_identity
      ON resolution.place_cluster_members (provider_key, external_place_id, proposal_id);

    CREATE TABLE resolution.place_cluster_assessments (
      proposal_id uuid NOT NULL,
      proposal_version integer NOT NULL,
      left_observation_id uuid NOT NULL,
      right_observation_id uuid NOT NULL,
      assessment_policy_version text NOT NULL,
      PRIMARY KEY (
        proposal_id, proposal_version,
        left_observation_id, right_observation_id, assessment_policy_version
      ),
      CHECK (left_observation_id < right_observation_id),
      FOREIGN KEY (proposal_id, proposal_version)
        REFERENCES resolution.place_cluster_proposals (proposal_id, proposal_version),
      FOREIGN KEY (proposal_id, proposal_version, left_observation_id)
        REFERENCES resolution.place_cluster_members (
          proposal_id, proposal_version, source_observation_id
        ),
      FOREIGN KEY (proposal_id, proposal_version, right_observation_id)
        REFERENCES resolution.place_cluster_members (
          proposal_id, proposal_version, source_observation_id
        ),
      FOREIGN KEY (left_observation_id, right_observation_id, assessment_policy_version)
        REFERENCES resolution.match_assessments (
          left_observation_id, right_observation_id, policy_version
        )
    );

    COMMENT ON TABLE resolution.place_cluster_assessments IS
      'Normalized supporting edges for one immutable shadow cluster proposal.';

    GRANT SELECT, INSERT ON TABLE
      resolution.place_cluster_proposals,
      resolution.place_cluster_members,
      resolution.place_cluster_assessments
    TO place_app;
  `)
}

export function down(pgm: MigrationBuilder): void {
  pgm.sql(`
    DROP TABLE resolution.place_cluster_assessments;
    DROP TABLE resolution.place_cluster_members;
    DROP TABLE resolution.place_cluster_proposals;
  `)
}
