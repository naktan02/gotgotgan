import type { MigrationBuilder } from 'node-pg-migrate'

export function up(pgm: MigrationBuilder): void {
  pgm.sql(`
    CREATE SCHEMA writing;
    REVOKE ALL ON SCHEMA writing FROM PUBLIC;

    CREATE TABLE writing.documents (
      id uuid PRIMARY KEY,
      owner_membership_id uuid NOT NULL REFERENCES access.memberships (id),
      kind text NOT NULL CHECK (kind IN ('note', 'entry')),
      title text,
      body text NOT NULL,
      visibility text NOT NULL CHECK (visibility IN ('private', 'unlisted', 'public')),
      publication_id uuid UNIQUE,
      version bigint NOT NULL CHECK (version > 0),
      created_at timestamptz NOT NULL,
      updated_at timestamptz NOT NULL,
      CHECK ((kind = 'note' AND title IS NULL AND length(body) BETWEEN 1 AND 2000)
        OR (kind = 'entry' AND length(title) BETWEEN 1 AND 200 AND length(body) BETWEEN 1 AND 100000)),
      CHECK ((visibility = 'private') = (publication_id IS NULL))
    );

    CREATE TABLE writing.document_place_links (
      document_id uuid NOT NULL REFERENCES writing.documents (id),
      canonical_place_id uuid NOT NULL REFERENCES places.canonical_places (id),
      position integer NOT NULL CHECK (position BETWEEN 0 AND 31),
      PRIMARY KEY (document_id, canonical_place_id),
      UNIQUE (document_id, position)
    );

    CREATE TABLE writing.document_revisions (
      document_id uuid NOT NULL REFERENCES writing.documents (id),
      version bigint NOT NULL,
      title text,
      body text NOT NULL,
      visibility text NOT NULL,
      publication_id uuid,
      canonical_place_ids uuid[] NOT NULL CHECK (cardinality(canonical_place_ids) BETWEEN 1 AND 32),
      changed_at timestamptz NOT NULL,
      PRIMARY KEY (document_id, version)
    );

    CREATE TABLE writing.command_receipts (
      command_id uuid PRIMARY KEY,
      membership_id uuid NOT NULL REFERENCES access.memberships (id),
      command_kind text NOT NULL,
      command_fingerprint text NOT NULL CHECK (command_fingerprint ~ '^[a-f0-9]{64}$'),
      outcome text NOT NULL CHECK (outcome IN ('applied', 'not-found', 'version-conflict')),
      document_id uuid,
      document_version bigint,
      occurred_at timestamptz NOT NULL
    );

    CREATE INDEX writing_documents_owner_updated ON writing.documents (owner_membership_id, updated_at DESC);

    GRANT USAGE ON SCHEMA writing TO place_app;
    GRANT SELECT, INSERT, UPDATE ON TABLE writing.documents TO place_app;
    GRANT SELECT, INSERT, DELETE ON TABLE writing.document_place_links TO place_app;
    GRANT SELECT, INSERT ON TABLE writing.document_revisions, writing.command_receipts TO place_app;
  `)
}

export function down(pgm: MigrationBuilder): void {
  pgm.sql('DROP SCHEMA writing CASCADE;')
}
