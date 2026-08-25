import type { MigrationBuilder } from 'node-pg-migrate'

export function up(pgm: MigrationBuilder): void {
  pgm.sql(`
    CREATE TABLE search.suggestion_sessions (
      id uuid PRIMARY KEY,
      created_at timestamptz NOT NULL,
      last_used_at timestamptz NOT NULL,
      expires_at timestamptz NOT NULL,
      closed_at timestamptz,
      CHECK (expires_at > created_at),
      CHECK (closed_at IS NULL OR closed_at >= created_at)
    );

    CREATE TABLE search.discovery_candidates (
      discovery_key text PRIMARY KEY CHECK (length(discovery_key) BETWEEN 1 AND 128),
      candidate_key text NOT NULL CHECK (length(candidate_key) BETWEEN 1 AND 512),
      provider_key text NOT NULL CHECK (provider_key IN ('naver', 'kakao', 'google')),
      provider_place_id text CHECK (length(provider_place_id) BETWEEN 1 AND 512),
      source_key text NOT NULL CHECK (length(source_key) BETWEEN 1 AND 64),
      source_label text NOT NULL CHECK (length(source_label) BETWEEN 1 AND 120),
      external_uri text,
      details_available boolean NOT NULL,
      attributions jsonb NOT NULL CHECK (jsonb_typeof(attributions) = 'array'),
      display_name text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 300),
      area_label text CHECK (length(area_label) BETWEEN 1 AND 300),
      category_label text CHECK (length(category_label) BETWEEN 1 AND 300),
      search_text text NOT NULL CHECK (search_text <> ''),
      location geometry(Point, 4326),
      observed_at timestamptz NOT NULL,
      first_seen_at timestamptz NOT NULL,
      last_seen_at timestamptz NOT NULL,
      expires_at timestamptz NOT NULL,
      impression_count bigint NOT NULL DEFAULT 1 CHECK (impression_count > 0),
      selection_count bigint NOT NULL DEFAULT 0 CHECK (selection_count >= 0),
      CHECK (expires_at > first_seen_at)
    );

    CREATE TABLE search.suggestion_impressions (
      suggestion_id uuid PRIMARY KEY,
      session_id uuid NOT NULL REFERENCES search.suggestion_sessions(id) ON DELETE CASCADE,
      candidate_key text NOT NULL CHECK (length(candidate_key) BETWEEN 1 AND 512),
      identity_kind text NOT NULL CHECK (identity_kind IN ('canonical', 'provider')),
      canonical_place_id uuid,
      provider_key text CHECK (provider_key IN ('naver', 'kakao', 'google')),
      provider_place_id text CHECK (length(provider_place_id) BETWEEN 1 AND 512),
      discovery_key text,
      source_key text NOT NULL CHECK (length(source_key) BETWEEN 1 AND 64),
      source_label text NOT NULL CHECK (length(source_label) BETWEEN 1 AND 120),
      external_uri text,
      details_available boolean NOT NULL,
      attributions jsonb NOT NULL CHECK (jsonb_typeof(attributions) = 'array'),
      display_name text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 300),
      area_label text CHECK (length(area_label) BETWEEN 1 AND 300),
      category_label text CHECK (length(category_label) BETWEEN 1 AND 300),
      location geometry(Point, 4326),
      observed_at timestamptz NOT NULL,
      observation_id uuid,
      candidate_id uuid,
      decision_id uuid,
      proposed_place_id uuid,
      created_at timestamptz NOT NULL,
      expires_at timestamptz NOT NULL,
      selected_at timestamptz,
      materialized_at timestamptz,
      UNIQUE (session_id, candidate_key),
      CHECK (
        (identity_kind = 'canonical' AND canonical_place_id IS NOT NULL AND provider_key IS NULL
          AND observation_id IS NULL AND candidate_id IS NULL AND decision_id IS NULL
          AND proposed_place_id IS NULL AND discovery_key IS NULL)
        OR
        (identity_kind = 'provider' AND canonical_place_id IS NULL AND provider_key IS NOT NULL
          AND observation_id IS NOT NULL AND candidate_id IS NOT NULL AND decision_id IS NOT NULL
          AND proposed_place_id IS NOT NULL AND discovery_key IS NOT NULL)
      ),
      CHECK (expires_at > created_at)
    );

    CREATE INDEX search_suggestion_sessions_expiry
      ON search.suggestion_sessions (expires_at, id);
    CREATE INDEX search_discovery_candidates_text_trgm
      ON search.discovery_candidates USING gin (search_text gin_trgm_ops);
    CREATE INDEX search_discovery_candidates_location_gist
      ON search.discovery_candidates USING gist (location);
    CREATE INDEX search_discovery_candidates_expiry
      ON search.discovery_candidates (expires_at, discovery_key);
    CREATE INDEX search_suggestion_impressions_session
      ON search.suggestion_impressions (session_id, created_at, suggestion_id);
    CREATE INDEX search_suggestion_impressions_expiry
      ON search.suggestion_impressions (expires_at, suggestion_id);

    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
      search.suggestion_sessions,
      search.discovery_candidates,
      search.suggestion_impressions
    TO place_app;
  `)
}

export function down(pgm: MigrationBuilder): void {
  pgm.sql(`
    DROP TABLE search.suggestion_impressions;
    DROP TABLE search.discovery_candidates;
    DROP TABLE search.suggestion_sessions;
  `)
}
