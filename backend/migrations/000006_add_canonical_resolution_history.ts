import type { MigrationBuilder } from 'node-pg-migrate'

export function up(pgm: MigrationBuilder): void {
  pgm.sql(`
    ALTER TABLE places.canonical_places
      ADD COLUMN status text NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'redirected', 'retired')),
      ADD COLUMN version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
      ADD COLUMN retired_at timestamptz,
      ADD CONSTRAINT canonical_places_retirement_consistent CHECK (
        (status = 'retired' AND retired_at IS NOT NULL)
        OR (status <> 'retired' AND retired_at IS NULL)
      );

    CREATE TABLE places.place_aliases (
      id uuid PRIMARY KEY,
      canonical_place_id uuid NOT NULL REFERENCES places.canonical_places (id),
      alias text NOT NULL CHECK (alias <> ''),
      language_tag text,
      source_observation_id uuid REFERENCES ingestion.source_observations (id),
      created_at timestamptz NOT NULL,
      UNIQUE (canonical_place_id, alias, language_tag, source_observation_id)
    );

    CREATE TABLE places.provider_place_identities (
      provider_key text NOT NULL CHECK (provider_key ~ '^[a-z][a-z0-9-]{0,62}$'),
      external_place_id text NOT NULL CHECK (external_place_id <> ''),
      canonical_place_id uuid NOT NULL REFERENCES places.canonical_places (id),
      linked_by_decision_id uuid NOT NULL,
      linked_at timestamptz NOT NULL,
      PRIMARY KEY (provider_key, external_place_id)
    );
    CREATE INDEX provider_place_identities_canonical_place
      ON places.provider_place_identities (canonical_place_id);

    CREATE TABLE places.applied_resolution_decisions (
      decision_id uuid PRIMARY KEY,
      source_decision_id uuid NOT NULL
        CONSTRAINT applied_resolution_decisions_source_decision_fkey
        REFERENCES ingestion.resolution_decisions (id),
      command_kind text NOT NULL CHECK (
        command_kind IN (
          'create-place', 'link-provider-identity', 'merge-places',
          'split-provider-identity', 'retire-place'
        )
      ),
      command_fingerprint text NOT NULL CHECK (command_fingerprint ~ '^[a-f0-9]{64}$'),
      outcome text NOT NULL CHECK (
        outcome IN (
          'applied', 'invalid', 'not-found', 'not-active',
          'identity-already-linked', 'identity-not-linked'
        )
      ),
      command jsonb NOT NULL,
      policy_version text NOT NULL CHECK (policy_version <> ''),
      occurred_at timestamptz NOT NULL
    );

    CREATE TABLE places.canonical_place_redirects (
      source_place_id uuid PRIMARY KEY REFERENCES places.canonical_places (id),
      target_place_id uuid NOT NULL REFERENCES places.canonical_places (id),
      decision_id uuid NOT NULL UNIQUE REFERENCES places.applied_resolution_decisions (decision_id),
      created_at timestamptz NOT NULL,
      CHECK (source_place_id <> target_place_id)
    );
    CREATE INDEX canonical_place_redirects_target
      ON places.canonical_place_redirects (target_place_id);

    CREATE TABLE places.canonical_place_lineage_events (
      decision_id uuid PRIMARY KEY REFERENCES places.applied_resolution_decisions (decision_id),
      event_kind text NOT NULL CHECK (event_kind IN ('merge', 'split')),
      source_place_id uuid NOT NULL REFERENCES places.canonical_places (id),
      target_place_id uuid NOT NULL REFERENCES places.canonical_places (id),
      provider_key text,
      external_place_id text,
      occurred_at timestamptz NOT NULL,
      CHECK (source_place_id <> target_place_id),
      CHECK (
        (event_kind = 'merge' AND provider_key IS NULL AND external_place_id IS NULL)
        OR (event_kind = 'split' AND provider_key IS NOT NULL AND external_place_id IS NOT NULL)
      )
    );

    GRANT SELECT, INSERT ON TABLE
      places.place_aliases,
      places.provider_place_identities,
      places.applied_resolution_decisions,
      places.canonical_place_redirects,
      places.canonical_place_lineage_events
    TO place_app;
    GRANT UPDATE (canonical_place_id, linked_by_decision_id, linked_at)
      ON places.provider_place_identities TO place_app;
  `)
}

export function down(pgm: MigrationBuilder): void {
  pgm.sql(`
    DROP TABLE places.canonical_place_lineage_events;
    DROP TABLE places.canonical_place_redirects;
    DROP TABLE places.applied_resolution_decisions;
    DROP TABLE places.provider_place_identities;
    DROP TABLE places.place_aliases;
    ALTER TABLE places.canonical_places
      DROP CONSTRAINT canonical_places_retirement_consistent,
      DROP COLUMN retired_at,
      DROP COLUMN version,
      DROP COLUMN status;
  `)
}
