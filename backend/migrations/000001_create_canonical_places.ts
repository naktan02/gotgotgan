import type { MigrationBuilder } from 'node-pg-migrate'

export function up(pgm: MigrationBuilder): void {
  pgm.sql(`
    CREATE SCHEMA places;
    REVOKE ALL ON SCHEMA places FROM PUBLIC;

    CREATE TABLE places.canonical_places (
      id uuid PRIMARY KEY,
      location geography(Point, 4326),
      created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    COMMENT ON TABLE places.canonical_places IS
      'Provider-independent identities for real-world places managed by Place.';

    CREATE INDEX canonical_places_location_gist
      ON places.canonical_places
      USING gist (location)
      WHERE location IS NOT NULL;

    GRANT USAGE ON SCHEMA places TO place_app;
    GRANT SELECT, INSERT, UPDATE ON TABLE places.canonical_places TO place_app;
  `)
}

export function down(pgm: MigrationBuilder): void {
  pgm.sql('DROP SCHEMA places CASCADE;')
}
