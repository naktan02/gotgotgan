import type { MigrationBuilder } from 'node-pg-migrate'

export function up(pgm: MigrationBuilder): void {
  pgm.sql(`
    ALTER TABLE access.memberships
      ADD COLUMN user_grade text;

    UPDATE access.memberships
    SET user_grade = 'unclassified';

    ALTER TABLE access.memberships
      ALTER COLUMN user_grade SET NOT NULL,
      ADD CONSTRAINT memberships_user_grade_nonempty CHECK (user_grade <> '');

    CREATE TABLE access.membership_consents (
      membership_id uuid NOT NULL
        REFERENCES access.memberships (id) ON DELETE CASCADE,
      document text NOT NULL CHECK (document <> ''),
      version text NOT NULL CHECK (version <> ''),
      accepted_at timestamptz NOT NULL,
      PRIMARY KEY (membership_id, document, version)
    );

    ALTER TABLE access.audit_events
      DROP CONSTRAINT audit_events_event_kind_check,
      ADD CONSTRAINT audit_events_event_kind_check
        CHECK (
          event_kind IN (
            'access-decision',
            'initial-owner-bootstrap',
            'authority-role-change',
            'membership-onboarding'
          )
        );

    GRANT SELECT, INSERT ON TABLE access.membership_consents TO place_app;
  `)
}

export function down(pgm: MigrationBuilder): void {
  pgm.sql(`
    ALTER TABLE access.audit_events
      DROP CONSTRAINT audit_events_event_kind_check,
      ADD CONSTRAINT audit_events_event_kind_check
        CHECK (
          event_kind IN (
            'access-decision',
            'initial-owner-bootstrap',
            'authority-role-change'
          )
        );

    DROP TABLE access.membership_consents;

    ALTER TABLE access.memberships
      DROP COLUMN user_grade;
  `)
}
