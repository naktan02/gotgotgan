import type { MigrationBuilder } from 'node-pg-migrate'

export function up(pgm: MigrationBuilder): void {
  pgm.sql(`
    DROP INDEX access.memberships_active_owner_idx;
    CREATE UNIQUE INDEX memberships_active_owner_idx
      ON access.memberships ((authority_role))
      WHERE authority_role = 'owner';

    CREATE TABLE access.platform_owner_projection (
      singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
      membership_id uuid UNIQUE
        REFERENCES access.memberships (id) ON DELETE RESTRICT,
      previous_authority_role text
        CHECK (previous_authority_role IN ('member', 'reviewer', 'administrator')),
      authority_revision bigint NOT NULL CHECK (authority_revision >= 0),
      owner_revision bigint NOT NULL CHECK (owner_revision >= 0),
      evidence_expires_at timestamptz NOT NULL,
      observed_at timestamptz NOT NULL,
      CHECK (
        (membership_id IS NULL AND previous_authority_role IS NULL) OR
        (membership_id IS NOT NULL AND previous_authority_role IS NOT NULL)
      )
    );

    INSERT INTO access.platform_owner_projection (
      singleton,
      membership_id,
      previous_authority_role,
      authority_revision,
      owner_revision,
      evidence_expires_at,
      observed_at
    )
    SELECT
      true,
      memberships.id,
      'member',
      0,
      0,
      '-infinity'::timestamptz,
      '-infinity'::timestamptz
    FROM access.memberships memberships
    WHERE memberships.authority_role = 'owner'
    UNION ALL
    SELECT true, NULL, NULL, 0, 0, '-infinity'::timestamptz, '-infinity'::timestamptz
    WHERE NOT EXISTS (
      SELECT 1
      FROM access.memberships
      WHERE authority_role = 'owner'
    );

    ALTER TABLE access.audit_events
      DROP CONSTRAINT audit_events_event_kind_check,
      ADD CONSTRAINT audit_events_event_kind_check
        CHECK (
          event_kind IN (
            'access-decision',
            'initial-owner-bootstrap',
            'authority-role-change',
            'membership-onboarding',
            'platform-owner-projection'
          )
        );

    GRANT SELECT, UPDATE ON TABLE access.platform_owner_projection TO place_app;
  `)
}

export function down(pgm: MigrationBuilder): void {
  pgm.sql(`
    REVOKE ALL ON TABLE access.platform_owner_projection FROM place_app;
    DROP TABLE access.platform_owner_projection;

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

    DROP INDEX access.memberships_active_owner_idx;
    CREATE INDEX memberships_active_owner_idx
      ON access.memberships (id)
      WHERE status = 'active' AND authority_role = 'owner';
  `)
}
