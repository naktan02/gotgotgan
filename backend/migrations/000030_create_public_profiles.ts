import type { MigrationBuilder } from 'node-pg-migrate'

export function up(pgm: MigrationBuilder): void {
  pgm.sql(`
    CREATE SCHEMA profiles;
    REVOKE ALL ON SCHEMA profiles FROM PUBLIC;

    CREATE TABLE profiles.public_profiles (
      membership_id uuid PRIMARY KEY REFERENCES access.memberships (id) ON DELETE CASCADE,
      handle text NOT NULL UNIQUE,
      display_name text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 50),
      visibility text NOT NULL CHECK (visibility IN ('hidden', 'public')),
      created_at timestamptz NOT NULL,
      updated_at timestamptz NOT NULL,
      CHECK (handle = lower(handle)),
      CHECK (handle ~ '^[a-z0-9](?:[a-z0-9-]*[a-z0-9])$'),
      CHECK (length(handle) BETWEEN 3 AND 30),
      CHECK (handle NOT IN (
        'admin', 'api', 'auth', 'library', 'people', 'search', 'settings', 'share', 'support', 'www'
      ))
    );

    CREATE TABLE profiles.command_receipts (
      command_id uuid PRIMARY KEY,
      membership_id uuid NOT NULL REFERENCES access.memberships (id) ON DELETE CASCADE,
      command_fingerprint text NOT NULL CHECK (command_fingerprint ~ '^[a-f0-9]{64}$'),
      occurred_at timestamptz NOT NULL
    );

    GRANT USAGE ON SCHEMA profiles TO place_app;
    GRANT SELECT, INSERT ON TABLE profiles.public_profiles TO place_app;
    GRANT UPDATE (display_name, visibility, updated_at)
      ON TABLE profiles.public_profiles TO place_app;
    GRANT SELECT, INSERT ON TABLE profiles.command_receipts TO place_app;
  `)
}

export function down(pgm: MigrationBuilder): void {
  pgm.sql('DROP SCHEMA profiles CASCADE;')
}
