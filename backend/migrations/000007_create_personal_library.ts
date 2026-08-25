import type { MigrationBuilder } from 'node-pg-migrate'

export function up(pgm: MigrationBuilder): void {
  pgm.sql(`
    CREATE SCHEMA library;
    REVOKE ALL ON SCHEMA library FROM PUBLIC;

    CREATE TABLE library.place_preferences (
      membership_id uuid NOT NULL REFERENCES access.memberships (id),
      canonical_place_id uuid NOT NULL REFERENCES places.canonical_places (id),
      saved boolean NOT NULL,
      wanted boolean NOT NULL,
      personal_rating numeric(2,1) CHECK (personal_rating BETWEEN 0.1 AND 5.0),
      created_at timestamptz NOT NULL,
      updated_at timestamptz NOT NULL,
      PRIMARY KEY (membership_id, canonical_place_id)
    );

    CREATE TABLE library.personal_rating_events (
      command_id uuid PRIMARY KEY,
      membership_id uuid NOT NULL REFERENCES access.memberships (id),
      canonical_place_id uuid NOT NULL REFERENCES places.canonical_places (id),
      previous_rating numeric(2,1),
      next_rating numeric(2,1),
      occurred_at timestamptz NOT NULL,
      CHECK (previous_rating IS NULL OR previous_rating BETWEEN 0.1 AND 5.0),
      CHECK (next_rating IS NULL OR next_rating BETWEEN 0.1 AND 5.0)
    );

    CREATE TABLE library.collections (
      id uuid PRIMARY KEY,
      owner_membership_id uuid NOT NULL REFERENCES access.memberships (id),
      name text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
      description text CHECK (length(description) <= 2000),
      visibility text NOT NULL CHECK (visibility IN ('private', 'unlisted', 'public')),
      publication_id uuid UNIQUE,
      created_at timestamptz NOT NULL,
      updated_at timestamptz NOT NULL,
      CHECK ((visibility = 'private') = (publication_id IS NULL))
    );

    CREATE TABLE library.collection_places (
      collection_id uuid NOT NULL REFERENCES library.collections (id),
      canonical_place_id uuid NOT NULL REFERENCES places.canonical_places (id),
      position integer NOT NULL CHECK (position >= 0),
      added_at timestamptz NOT NULL,
      PRIMARY KEY (collection_id, canonical_place_id),
      UNIQUE (collection_id, position)
    );

    CREATE TABLE library.tags (
      id uuid PRIMARY KEY,
      owner_membership_id uuid NOT NULL REFERENCES access.memberships (id),
      name text NOT NULL CHECK (length(name) BETWEEN 1 AND 64),
      normalized_name text NOT NULL CHECK (normalized_name <> ''),
      created_at timestamptz NOT NULL,
      UNIQUE (owner_membership_id, normalized_name)
    );

    CREATE TABLE library.place_tags (
      membership_id uuid NOT NULL REFERENCES access.memberships (id),
      canonical_place_id uuid NOT NULL REFERENCES places.canonical_places (id),
      tag_id uuid NOT NULL REFERENCES library.tags (id),
      tagged_at timestamptz NOT NULL,
      PRIMARY KEY (membership_id, canonical_place_id, tag_id)
    );

    CREATE TABLE library.collection_copy_provenance (
      target_collection_id uuid PRIMARY KEY REFERENCES library.collections (id),
      source_publication_id uuid NOT NULL,
      copied_at timestamptz NOT NULL
    );

    CREATE TABLE library.command_receipts (
      command_id uuid PRIMARY KEY,
      membership_id uuid NOT NULL REFERENCES access.memberships (id),
      command_kind text NOT NULL,
      command_fingerprint text NOT NULL CHECK (command_fingerprint ~ '^[a-f0-9]{64}$'),
      outcome text NOT NULL CHECK (outcome IN ('applied', 'not-found', 'forbidden')),
      occurred_at timestamptz NOT NULL
    );

    CREATE INDEX collections_owner_updated ON library.collections (owner_membership_id, updated_at DESC);
    CREATE INDEX rating_events_member_place ON library.personal_rating_events (membership_id, canonical_place_id, occurred_at DESC);

    GRANT USAGE ON SCHEMA library TO place_app;
    GRANT SELECT, INSERT, UPDATE ON TABLE library.place_preferences, library.collections TO place_app;
    GRANT SELECT, INSERT ON TABLE library.personal_rating_events, library.collection_copy_provenance, library.command_receipts TO place_app;
    GRANT SELECT, INSERT, DELETE ON TABLE library.collection_places, library.place_tags TO place_app;
    GRANT UPDATE (position) ON TABLE library.collection_places TO place_app;
    GRANT SELECT, INSERT, UPDATE ON TABLE library.tags TO place_app;
  `)
}

export function down(pgm: MigrationBuilder): void {
  pgm.sql('DROP SCHEMA library CASCADE;')
}
