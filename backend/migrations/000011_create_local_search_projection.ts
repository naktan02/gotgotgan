import type { MigrationBuilder } from 'node-pg-migrate'

export function up(pgm: MigrationBuilder): void {
  pgm.sql(`
    CREATE SCHEMA search;
    REVOKE ALL ON SCHEMA search FROM PUBLIC;

    CREATE TABLE search.place_documents (
      place_id uuid PRIMARY KEY,
      source_version bigint NOT NULL CHECK (source_version > 0),
      display_name text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 300),
      area_label text CHECK (length(area_label) BETWEEN 1 AND 300),
      search_text text NOT NULL CHECK (search_text <> ''),
      location geometry(Point, 4326) NOT NULL,
      primary_taxonomy_key text CHECK (length(primary_taxonomy_key) BETWEEN 1 AND 128),
      primary_taxonomy_label text CHECK (length(primary_taxonomy_label) BETWEEN 1 AND 160),
      taxonomy_keys text[] NOT NULL DEFAULT '{}',
      evidence_status text NOT NULL CHECK (evidence_status IN ('verified', 'unverified', 'conflicted', 'stale')),
      projected_at timestamptz NOT NULL,
      CHECK ((primary_taxonomy_key IS NULL) = (primary_taxonomy_label IS NULL))
    );

    CREATE TABLE search.member_place_signals (
      membership_id uuid NOT NULL,
      place_id uuid NOT NULL,
      source_version bigint NOT NULL CHECK (source_version > 0),
      saved boolean NOT NULL,
      wanted boolean NOT NULL,
      visited boolean NOT NULL,
      personal_rating numeric(2,1),
      projected_at timestamptz NOT NULL,
      PRIMARY KEY (membership_id, place_id),
      CHECK (personal_rating IS NULL OR personal_rating BETWEEN 0.1 AND 5.0)
    );

    CREATE INDEX search_place_documents_text_trgm
      ON search.place_documents USING gin (search_text gin_trgm_ops);
    CREATE INDEX search_place_documents_location_gist
      ON search.place_documents USING gist (location);
    CREATE INDEX search_place_documents_taxonomy_gin
      ON search.place_documents USING gin (taxonomy_keys);
    CREATE INDEX search_member_place_signals_filters
      ON search.member_place_signals
      (membership_id, saved, wanted, visited, personal_rating, place_id);

    GRANT USAGE ON SCHEMA search TO place_app;
    GRANT SELECT, INSERT, UPDATE ON TABLE search.place_documents, search.member_place_signals TO place_app;
  `)
}

export function down(pgm: MigrationBuilder): void {
  pgm.sql('DROP SCHEMA search CASCADE;')
}
