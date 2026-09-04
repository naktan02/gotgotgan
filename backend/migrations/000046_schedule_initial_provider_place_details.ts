import type { MigrationBuilder } from 'node-pg-migrate'

export function up(pgm: MigrationBuilder): void {
  pgm.sql(`
    CREATE FUNCTION ingestion.schedule_initial_provider_place_details(
      requested_provider_key text,
      requested_provider_place_ids text[],
      requested_at timestamptz
    ) RETURNS integer
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog
    AS $$
    DECLARE
      detail_requested_at ALIAS FOR $3;
      scheduled_count integer;
    BEGIN
      IF requested_provider_key IS NULL
        OR requested_provider_key NOT IN ('naver', 'kakao', 'google') THEN
        RAISE EXCEPTION 'unsupported provider key';
      END IF;
      IF requested_provider_place_ids IS NULL OR detail_requested_at IS NULL THEN
        RAISE EXCEPTION 'provider place identities and requested time are required';
      END IF;
      IF pg_catalog.cardinality(requested_provider_place_ids) > 100000 THEN
        RAISE EXCEPTION 'provider place identity batch exceeds limit';
      END IF;

      INSERT INTO ingestion.provider_place_detail_statuses (
        provider_key, provider_place_id, status, requested_at, updated_at
      )
      SELECT requested_provider_key, requested.provider_place_id,
             'pending', detail_requested_at, detail_requested_at
      FROM (
        SELECT DISTINCT provider_place_id
        FROM pg_catalog.unnest(requested_provider_place_ids)
          AS requested_identity(provider_place_id)
      ) AS requested
      ORDER BY requested.provider_place_id
      ON CONFLICT (provider_key, provider_place_id) DO NOTHING;

      INSERT INTO ingestion.provider_place_detail_jobs (
        id, provider_key, provider_place_id, state, available_at,
        observation_id, candidate_id, created_at, updated_at
      )
      SELECT pg_catalog.gen_random_uuid(), status.provider_key, status.provider_place_id,
             'queued', detail_requested_at,
             pg_catalog.gen_random_uuid(), pg_catalog.gen_random_uuid(),
             detail_requested_at, detail_requested_at
      FROM ingestion.provider_place_detail_statuses AS status
      JOIN (
        SELECT DISTINCT provider_place_id
        FROM pg_catalog.unnest(requested_provider_place_ids)
          AS requested_identity(provider_place_id)
      ) AS requested ON requested.provider_place_id = status.provider_place_id
      WHERE status.provider_key = requested_provider_key
        AND status.status = 'pending'
        AND NOT EXISTS (
          SELECT 1
          FROM ingestion.provider_place_detail_jobs AS active
          WHERE active.provider_key = status.provider_key
            AND active.provider_place_id = status.provider_place_id
            AND active.state IN ('queued', 'waiting', 'leased')
        )
      ORDER BY status.provider_key, status.provider_place_id
      ON CONFLICT (provider_key, provider_place_id)
        WHERE state IN ('queued', 'waiting', 'leased') DO NOTHING;

      GET DIAGNOSTICS scheduled_count = ROW_COUNT;
      RETURN scheduled_count;
    END
    $$;

    REVOKE ALL ON FUNCTION ingestion.schedule_initial_provider_place_details(
      text, text[], timestamptz
    ) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION ingestion.schedule_initial_provider_place_details(
      text, text[], timestamptz
    ) TO place_app;
  `)
}

export function down(pgm: MigrationBuilder): void {
  pgm.sql(`
    REVOKE EXECUTE ON FUNCTION ingestion.schedule_initial_provider_place_details(
      text, text[], timestamptz
    ) FROM place_app;
    DROP FUNCTION ingestion.schedule_initial_provider_place_details(
      text, text[], timestamptz
    );
  `)
}
