import type { MigrationBuilder } from 'node-pg-migrate'

export function up(pgm: MigrationBuilder): void {
  pgm.sql(`
    CREATE TABLE profiles.public_profile_reports (
      report_id uuid PRIMARY KEY,
      reporter_membership_id uuid
        REFERENCES access.memberships (id) ON DELETE SET NULL,
      handle text NOT NULL
        REFERENCES profiles.public_handle_reservations (handle) ON DELETE RESTRICT,
      reason text NOT NULL CHECK (reason IN (
        'impersonation', 'harassment', 'privacy', 'spam', 'unsafe-content'
      )),
      report_fingerprint text NOT NULL CHECK (report_fingerprint ~ '^[a-f0-9]{64}$'),
      reported_at timestamptz NOT NULL,
      expires_at timestamptz NOT NULL,
      reviewed_at timestamptz,
      CHECK (expires_at > reported_at),
      CHECK (reviewed_at IS NULL OR reviewed_at >= reported_at)
    );

    CREATE UNIQUE INDEX public_profile_reports_reporter_handle_idx
      ON profiles.public_profile_reports (reporter_membership_id, handle)
      WHERE reporter_membership_id IS NOT NULL;
    CREATE INDEX public_profile_reports_pending_idx
      ON profiles.public_profile_reports (reported_at DESC, report_id DESC)
      WHERE reviewed_at IS NULL;

    CREATE TABLE profiles.public_profile_moderation (
      handle text PRIMARY KEY
        REFERENCES profiles.public_handle_reservations (handle) ON DELETE RESTRICT,
      state text NOT NULL CHECK (state IN ('allowed', 'withheld')),
      reason text NOT NULL CHECK (reason IN (
        'impersonation', 'harassment', 'privacy', 'spam', 'unsafe-content',
        'insufficient-evidence', 'appeal-accepted'
      )),
      decided_by_membership_id uuid NOT NULL,
      updated_at timestamptz NOT NULL,
      CHECK (
        (state = 'withheld' AND reason IN (
          'impersonation', 'harassment', 'privacy', 'spam', 'unsafe-content'
        )) OR
        (state = 'allowed' AND reason IN ('insufficient-evidence', 'appeal-accepted'))
      )
    );

    CREATE TABLE profiles.public_profile_moderation_decisions (
      decision_id uuid PRIMARY KEY,
      handle text NOT NULL
        REFERENCES profiles.public_handle_reservations (handle) ON DELETE RESTRICT,
      actor_membership_id uuid NOT NULL,
      previous_state text NOT NULL CHECK (previous_state IN ('allowed', 'withheld')),
      next_state text NOT NULL CHECK (next_state IN ('allowed', 'withheld')),
      reason text NOT NULL CHECK (reason IN (
        'impersonation', 'harassment', 'privacy', 'spam', 'unsafe-content',
        'insufficient-evidence', 'appeal-accepted'
      )),
      decision_fingerprint text NOT NULL CHECK (decision_fingerprint ~ '^[a-f0-9]{64}$'),
      decided_at timestamptz NOT NULL,
      CHECK (
        (next_state = 'withheld' AND reason IN (
          'impersonation', 'harassment', 'privacy', 'spam', 'unsafe-content'
        )) OR
        (next_state = 'allowed' AND reason IN ('insufficient-evidence', 'appeal-accepted'))
      )
    );

    CREATE INDEX public_profile_moderation_decisions_handle_idx
      ON profiles.public_profile_moderation_decisions (handle, decided_at DESC, decision_id DESC);

    CREATE FUNCTION profiles.close_deleted_public_profile_reports()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, profiles
    AS $function$
    BEGIN
      UPDATE profiles.public_profile_reports
         SET reviewed_at = GREATEST(reported_at, clock_timestamp())
       WHERE handle = OLD.handle
         AND reviewed_at IS NULL;
      RETURN OLD;
    END;
    $function$;
    REVOKE ALL ON FUNCTION profiles.close_deleted_public_profile_reports() FROM PUBLIC;

    CREATE TRIGGER close_deleted_public_profile_reports_trigger
      AFTER DELETE ON profiles.public_profiles
      FOR EACH ROW
      EXECUTE FUNCTION profiles.close_deleted_public_profile_reports();

    GRANT SELECT, INSERT, DELETE ON TABLE profiles.public_profile_reports TO place_app;
    GRANT UPDATE (reviewed_at) ON TABLE profiles.public_profile_reports TO place_app;
    GRANT SELECT, INSERT ON TABLE profiles.public_profile_moderation TO place_app;
    GRANT UPDATE (state, reason, decided_by_membership_id, updated_at)
      ON TABLE profiles.public_profile_moderation TO place_app;
    GRANT SELECT, INSERT ON TABLE profiles.public_profile_moderation_decisions TO place_app;
  `)
}

export function down(pgm: MigrationBuilder): void {
  pgm.sql(`
    DROP TRIGGER close_deleted_public_profile_reports_trigger
      ON profiles.public_profiles;
    DROP FUNCTION profiles.close_deleted_public_profile_reports();
    DROP TABLE profiles.public_profile_moderation_decisions;
    DROP TABLE profiles.public_profile_moderation;
    DROP TABLE profiles.public_profile_reports;
  `)
}
