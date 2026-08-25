import type { MigrationBuilder } from 'node-pg-migrate'

export function up(pgm: MigrationBuilder): void {
  pgm.sql(`
    CREATE SCHEMA visits;
    REVOKE ALL ON SCHEMA visits FROM PUBLIC;

    CREATE TABLE visits.visit_occurrences (
      id uuid PRIMARY KEY,
      membership_id uuid NOT NULL REFERENCES access.memberships (id),
      canonical_place_id uuid NOT NULL REFERENCES places.canonical_places (id),
      visited_at timestamptz NOT NULL,
      recorded_at timestamptz NOT NULL,
      evidence jsonb,
      fingerprint text NOT NULL CHECK (fingerprint ~ '^[a-f0-9]{64}$'),
      CHECK (evidence IS NULL OR jsonb_typeof(evidence) = 'object'),
      CHECK (visited_at <= recorded_at)
    );

    CREATE INDEX visit_occurrences_member_place_time
      ON visits.visit_occurrences (membership_id, canonical_place_id, visited_at DESC);

    GRANT USAGE ON SCHEMA visits TO place_app;
    GRANT SELECT, INSERT ON TABLE visits.visit_occurrences TO place_app;
  `)
}

export function down(pgm: MigrationBuilder): void {
  pgm.sql('DROP SCHEMA visits CASCADE;')
}
