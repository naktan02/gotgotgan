import type { MigrationBuilder } from 'node-pg-migrate'

export function up(pgm: MigrationBuilder): void {
  pgm.sql(`
    CREATE SCHEMA taxonomy;
    REVOKE ALL ON SCHEMA taxonomy FROM PUBLIC;

    CREATE TABLE taxonomy.node_versions (
      node_key text NOT NULL CHECK (length(node_key) BETWEEN 1 AND 128),
      version integer NOT NULL CHECK (version > 0),
      parent_key text CHECK (length(parent_key) BETWEEN 1 AND 128),
      label text NOT NULL CHECK (length(label) BETWEEN 1 AND 160),
      kind text NOT NULL CHECK (kind IN ('category', 'attribute')),
      active boolean NOT NULL,
      effective_at timestamptz NOT NULL,
      PRIMARY KEY (node_key, version),
      CHECK (parent_key IS NULL OR parent_key <> node_key)
    );

    CREATE INDEX taxonomy_node_versions_current
      ON taxonomy.node_versions (node_key, version DESC);

    GRANT USAGE ON SCHEMA taxonomy TO place_app;
    GRANT SELECT, INSERT ON TABLE taxonomy.node_versions TO place_app;
  `)
}

export function down(pgm: MigrationBuilder): void {
  pgm.sql('DROP SCHEMA taxonomy CASCADE;')
}
