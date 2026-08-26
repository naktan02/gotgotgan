import type { MigrationBuilder } from 'node-pg-migrate'

export function up(pgm: MigrationBuilder): void {
  pgm.sql(`
    CREATE UNIQUE INDEX provider_connections_connector_installation
      ON ingestion.provider_connections (member_id, provider_key, profile_reference)
      WHERE profile_reference LIKE 'connector:%';

    CREATE TABLE ingestion.connector_import_operations (
      id uuid PRIMARY KEY,
      member_id uuid NOT NULL REFERENCES access.memberships(id),
      connection_id uuid NOT NULL REFERENCES ingestion.provider_connections(id),
      import_batch_id uuid NOT NULL UNIQUE REFERENCES ingestion.import_batches(id),
      installation_id uuid NOT NULL,
      browser_key text NOT NULL CHECK (browser_key IN (
        'chrome', 'edge', 'whale', 'firefox', 'safari', 'chromium-other'
      )),
      provider_key text NOT NULL CHECK (provider_key IN ('naver', 'kakao', 'google')),
      operation_kind text NOT NULL CHECK (operation_kind = 'import-saved-library'),
      idempotency_key uuid NOT NULL,
      request_fingerprint text NOT NULL CHECK (request_fingerprint ~ '^[a-f0-9]{64}$'),
      token_digest text NOT NULL UNIQUE CHECK (token_digest ~ '^[a-f0-9]{64}$'),
      place_origin text NOT NULL CHECK (length(place_origin) BETWEEN 8 AND 2048),
      maximum_items integer NOT NULL CHECK (maximum_items BETWEEN 1 AND 100000),
      maximum_bytes integer NOT NULL CHECK (maximum_bytes BETWEEN 1024 AND 134217728),
      maximum_batches integer NOT NULL CHECK (maximum_batches BETWEEN 1 AND 1000),
      maximum_batch_bytes integer NOT NULL CHECK (maximum_batch_bytes BETWEEN 1024 AND 4194304),
      next_sequence integer NOT NULL DEFAULT 0 CHECK (next_sequence BETWEEN 0 AND 1000),
      received_items integer NOT NULL DEFAULT 0 CHECK (received_items BETWEEN 0 AND 100000),
      received_bytes integer NOT NULL DEFAULT 0 CHECK (received_bytes BETWEEN 0 AND 134217728),
      state text NOT NULL CHECK (state IN ('receiving', 'completed', 'revoked')),
      expires_at timestamptz NOT NULL,
      created_at timestamptz NOT NULL,
      updated_at timestamptz NOT NULL,
      completed_at timestamptz,
      UNIQUE (member_id, idempotency_key),
      CHECK (maximum_batch_bytes <= maximum_bytes),
      CHECK ((state = 'completed') = (completed_at IS NOT NULL)),
      CHECK (expires_at > created_at),
      CHECK (updated_at >= created_at)
    );

    CREATE TABLE ingestion.connector_capture_receipts (
      operation_id uuid NOT NULL REFERENCES ingestion.connector_import_operations(id),
      sequence integer NOT NULL CHECK (sequence BETWEEN 0 AND 999),
      capture_id uuid NOT NULL UNIQUE REFERENCES ingestion.import_capture_artifacts(id),
      checksum text NOT NULL CHECK (checksum ~ '^[a-f0-9]{64}$'),
      item_count integer NOT NULL CHECK (item_count BETWEEN 0 AND 500),
      byte_count integer NOT NULL CHECK (byte_count BETWEEN 2 AND 4194304),
      final boolean NOT NULL,
      state text NOT NULL CHECK (state IN ('pending', 'committed')),
      cumulative_items integer CHECK (cumulative_items BETWEEN 0 AND 100000),
      cumulative_bytes integer CHECK (cumulative_bytes BETWEEN 0 AND 134217728),
      created_at timestamptz NOT NULL,
      committed_at timestamptz,
      PRIMARY KEY (operation_id, sequence),
      CHECK (
        (state = 'pending' AND cumulative_items IS NULL AND cumulative_bytes IS NULL AND committed_at IS NULL)
        OR
        (state = 'committed' AND cumulative_items IS NOT NULL AND cumulative_bytes IS NOT NULL AND committed_at IS NOT NULL)
      ),
      CHECK (committed_at IS NULL OR committed_at >= created_at)
    );

    CREATE INDEX connector_import_operations_expiry
      ON ingestion.connector_import_operations (expires_at, id)
      WHERE state = 'receiving';

    GRANT SELECT, INSERT ON TABLE
      ingestion.connector_import_operations,
      ingestion.connector_capture_receipts
    TO place_app;
    GRANT UPDATE (
      token_digest, expires_at, next_sequence, received_items, received_bytes,
      state, updated_at, completed_at
    ) ON ingestion.connector_import_operations TO place_app;
    GRANT UPDATE (state, cumulative_items, cumulative_bytes, committed_at)
      ON ingestion.connector_capture_receipts TO place_app;
  `)
}

export function down(pgm: MigrationBuilder): void {
  pgm.sql(`
    DROP TABLE ingestion.connector_capture_receipts;
    DROP TABLE ingestion.connector_import_operations;
    DROP INDEX ingestion.provider_connections_connector_installation;
  `)
}
