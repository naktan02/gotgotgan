import type { MigrationBuilder } from 'node-pg-migrate'

export function up(pgm: MigrationBuilder): void {
  pgm.sql(`
    CREATE SCHEMA browser_auth;
    REVOKE ALL ON SCHEMA browser_auth FROM PUBLIC;

    CREATE TABLE browser_auth.oidc_transactions (
      id text PRIMARY KEY
        CHECK (id ~ '^[A-Za-z0-9_-]+$' AND length(id) <= 256),
      encryption_key_id text NOT NULL CHECK (encryption_key_id <> ''),
      initialization_vector bytea NOT NULL
        CHECK (octet_length(initialization_vector) = 12),
      authentication_tag bytea NOT NULL
        CHECK (octet_length(authentication_tag) = 16),
      ciphertext bytea NOT NULL CHECK (octet_length(ciphertext) > 0),
      expires_at timestamptz NOT NULL,
      created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX oidc_transactions_expires_at_idx
      ON browser_auth.oidc_transactions (expires_at);

    CREATE TABLE browser_auth.sessions (
      id text PRIMARY KEY
        CHECK (id ~ '^[A-Za-z0-9_-]+$' AND length(id) <= 256),
      encryption_key_id text NOT NULL CHECK (encryption_key_id <> ''),
      initialization_vector bytea NOT NULL
        CHECK (octet_length(initialization_vector) = 12),
      authentication_tag bytea NOT NULL
        CHECK (octet_length(authentication_tag) = 16),
      ciphertext bytea NOT NULL CHECK (octet_length(ciphertext) > 0),
      expires_at timestamptz NOT NULL,
      created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX sessions_expires_at_idx
      ON browser_auth.sessions (expires_at);

    GRANT USAGE ON SCHEMA browser_auth TO place_app;
    GRANT SELECT, INSERT, DELETE ON TABLE browser_auth.oidc_transactions TO place_app;
    GRANT SELECT, INSERT, DELETE ON TABLE browser_auth.sessions TO place_app;
  `)
}

export function down(pgm: MigrationBuilder): void {
  pgm.sql('DROP SCHEMA browser_auth CASCADE;')
}
