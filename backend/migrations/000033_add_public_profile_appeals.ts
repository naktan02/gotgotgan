import type { MigrationBuilder } from 'node-pg-migrate'

export function up(pgm: MigrationBuilder): void {
  pgm.sql(`
    ALTER TABLE profiles.public_profile_moderation
      ADD COLUMN decision_id uuid;

    UPDATE profiles.public_profile_moderation moderation
       SET decision_id = (
         SELECT decision.decision_id
           FROM profiles.public_profile_moderation_decisions decision
          WHERE decision.handle = moderation.handle
          ORDER BY decision.decided_at DESC, decision.decision_id DESC
          LIMIT 1
       );

    ALTER TABLE profiles.public_profile_moderation
      ALTER COLUMN decision_id SET NOT NULL,
      ADD CONSTRAINT public_profile_moderation_decision_fk
        FOREIGN KEY (decision_id)
        REFERENCES profiles.public_profile_moderation_decisions (decision_id)
        ON DELETE RESTRICT,
      ADD CONSTRAINT public_profile_moderation_decision_unique UNIQUE (decision_id);

    CREATE TABLE profiles.public_profile_appeals (
      appeal_id uuid PRIMARY KEY,
      owner_membership_id uuid
        REFERENCES access.memberships (id) ON DELETE SET NULL,
      handle text NOT NULL
        REFERENCES profiles.public_handle_reservations (handle) ON DELETE RESTRICT,
      moderation_decision_id uuid NOT NULL
        REFERENCES profiles.public_profile_moderation_decisions (decision_id) ON DELETE RESTRICT,
      reason text NOT NULL CHECK (reason IN (
        'mistaken-identity', 'issue-corrected', 'decision-context'
      )),
      appeal_fingerprint text NOT NULL CHECK (appeal_fingerprint ~ '^[a-f0-9]{64}$'),
      status text NOT NULL CHECK (status IN ('pending', 'accepted', 'rejected', 'superseded')),
      submitted_at timestamptz NOT NULL,
      resolution_id uuid UNIQUE,
      resolved_at timestamptz,
      UNIQUE (handle, moderation_decision_id),
      CHECK (
        (status = 'pending' AND resolution_id IS NULL AND resolved_at IS NULL) OR
        (status <> 'pending' AND resolution_id IS NOT NULL AND resolved_at IS NOT NULL)
      ),
      CHECK (resolved_at IS NULL OR resolved_at >= submitted_at)
    );

    CREATE UNIQUE INDEX public_profile_appeals_one_pending_handle_idx
      ON profiles.public_profile_appeals (handle)
      WHERE status = 'pending';
    CREATE INDEX public_profile_appeals_owner_idx
      ON profiles.public_profile_appeals (owner_membership_id, submitted_at DESC, appeal_id DESC)
      WHERE owner_membership_id IS NOT NULL;
    CREATE INDEX public_profile_appeals_pending_idx
      ON profiles.public_profile_appeals (submitted_at, appeal_id)
      WHERE status = 'pending';

    CREATE TABLE profiles.public_profile_appeal_resolutions (
      resolution_id uuid PRIMARY KEY,
      appeal_id uuid NOT NULL UNIQUE
        REFERENCES profiles.public_profile_appeals (appeal_id) ON DELETE RESTRICT,
      actor_membership_id uuid,
      outcome text NOT NULL CHECK (outcome IN ('accepted', 'rejected', 'superseded')),
      reason text NOT NULL CHECK (reason IN (
        'appeal-accepted', 'decision-upheld', 'insufficient-remediation', 'profile-deleted'
      )),
      resolution_fingerprint text NOT NULL CHECK (resolution_fingerprint ~ '^[a-f0-9]{64}$'),
      decided_at timestamptz NOT NULL,
      CHECK (
        (outcome = 'accepted' AND actor_membership_id IS NOT NULL AND reason = 'appeal-accepted') OR
        (outcome = 'rejected' AND actor_membership_id IS NOT NULL AND reason IN (
          'decision-upheld', 'insufficient-remediation'
        )) OR
        (outcome = 'superseded' AND actor_membership_id IS NULL AND reason = 'profile-deleted')
      )
    );

    ALTER TABLE profiles.public_profile_appeals
      ADD CONSTRAINT public_profile_appeals_resolution_fk
      FOREIGN KEY (resolution_id)
      REFERENCES profiles.public_profile_appeal_resolutions (resolution_id)
      ON DELETE RESTRICT;

    CREATE TABLE profiles.public_profile_owner_notices (
      notice_id uuid PRIMARY KEY,
      owner_membership_id uuid NOT NULL
        REFERENCES access.memberships (id) ON DELETE CASCADE,
      handle text NOT NULL
        REFERENCES profiles.public_handle_reservations (handle) ON DELETE RESTRICT,
      moderation_decision_id uuid NOT NULL
        REFERENCES profiles.public_profile_moderation_decisions (decision_id) ON DELETE RESTRICT,
      appeal_resolution_id uuid
        REFERENCES profiles.public_profile_appeal_resolutions (resolution_id) ON DELETE RESTRICT,
      kind text NOT NULL CHECK (kind IN ('withheld', 'restored', 'appeal-rejected')),
      reason text NOT NULL CHECK (reason IN (
        'impersonation', 'harassment', 'privacy', 'spam', 'unsafe-content',
        'insufficient-evidence', 'appeal-accepted',
        'decision-upheld', 'insufficient-remediation'
      )),
      created_at timestamptz NOT NULL,
      acknowledged_at timestamptz,
      CHECK (acknowledged_at IS NULL OR acknowledged_at >= created_at),
      CHECK (
        (kind = 'withheld' AND appeal_resolution_id IS NULL AND reason IN (
          'impersonation', 'harassment', 'privacy', 'spam', 'unsafe-content'
        )) OR
        (kind = 'restored' AND (
          (reason = 'insufficient-evidence' AND appeal_resolution_id IS NULL) OR
          (reason = 'appeal-accepted' AND appeal_resolution_id IS NOT NULL)
        )) OR
        (kind = 'appeal-rejected' AND appeal_resolution_id IS NOT NULL AND reason IN (
          'decision-upheld', 'insufficient-remediation'
        ))
      )
    );

    CREATE INDEX public_profile_owner_notices_owner_idx
      ON profiles.public_profile_owner_notices
        (owner_membership_id, created_at DESC, notice_id DESC);

    INSERT INTO profiles.public_profile_owner_notices (
      notice_id, owner_membership_id, handle, moderation_decision_id,
      appeal_resolution_id, kind, reason, created_at, acknowledged_at
    )
    SELECT moderation.decision_id,
           profile.membership_id,
           moderation.handle,
           moderation.decision_id,
           NULL,
           'withheld',
           moderation.reason,
           moderation.updated_at,
           NULL
      FROM profiles.public_profile_moderation moderation
      JOIN profiles.public_profiles profile ON profile.handle = moderation.handle
     WHERE moderation.state = 'withheld';

    CREATE OR REPLACE FUNCTION profiles.close_deleted_public_profile_reports()
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

      WITH pending AS (
        SELECT appeal.appeal_id,
               gen_random_uuid() AS resolution_id,
               GREATEST(appeal.submitted_at, clock_timestamp()) AS decided_at
          FROM profiles.public_profile_appeals appeal
         WHERE appeal.handle = OLD.handle
           AND appeal.status = 'pending'
         FOR UPDATE
      ), inserted AS (
        INSERT INTO profiles.public_profile_appeal_resolutions (
          resolution_id, appeal_id, actor_membership_id, outcome, reason,
          resolution_fingerprint, decided_at
        )
        SELECT pending.resolution_id,
               pending.appeal_id,
               NULL,
               'superseded',
               'profile-deleted',
               encode(sha256(convert_to(
                 pending.appeal_id::text || ':profile-deleted', 'UTF8'
               )), 'hex'),
               pending.decided_at
          FROM pending
        RETURNING appeal_id, resolution_id, decided_at
      )
      UPDATE profiles.public_profile_appeals appeal
         SET status = 'superseded',
             resolution_id = inserted.resolution_id,
             resolved_at = inserted.decided_at
        FROM inserted
       WHERE appeal.appeal_id = inserted.appeal_id;

      RETURN OLD;
    END;
    $function$;
    REVOKE ALL ON FUNCTION profiles.close_deleted_public_profile_reports() FROM PUBLIC;

    GRANT UPDATE (decision_id) ON TABLE profiles.public_profile_moderation TO place_app;
    GRANT SELECT, INSERT ON TABLE profiles.public_profile_appeals TO place_app;
    GRANT UPDATE (status, resolution_id, resolved_at)
      ON TABLE profiles.public_profile_appeals TO place_app;
    GRANT SELECT, INSERT ON TABLE profiles.public_profile_appeal_resolutions TO place_app;
    GRANT SELECT, INSERT ON TABLE profiles.public_profile_owner_notices TO place_app;
    GRANT UPDATE (acknowledged_at) ON TABLE profiles.public_profile_owner_notices TO place_app;
  `)
}

export function down(pgm: MigrationBuilder): void {
  pgm.sql(`
    CREATE OR REPLACE FUNCTION profiles.close_deleted_public_profile_reports()
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

    DROP TABLE profiles.public_profile_owner_notices;
    ALTER TABLE profiles.public_profile_appeals
      DROP CONSTRAINT public_profile_appeals_resolution_fk;
    DROP TABLE profiles.public_profile_appeal_resolutions;
    DROP TABLE profiles.public_profile_appeals;
    ALTER TABLE profiles.public_profile_moderation
      DROP CONSTRAINT public_profile_moderation_decision_unique,
      DROP CONSTRAINT public_profile_moderation_decision_fk,
      DROP COLUMN decision_id;
  `)
}
