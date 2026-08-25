import type { MigrationBuilder } from 'node-pg-migrate'

export function up(pgm: MigrationBuilder): void {
  pgm.sql(`
    CREATE SCHEMA access;
    REVOKE ALL ON SCHEMA access FROM PUBLIC;

    CREATE TABLE access.memberships (
      id uuid PRIMARY KEY,
      issuer text NOT NULL CHECK (issuer <> ''),
      subject text NOT NULL CHECK (subject <> ''),
      status text NOT NULL CHECK (status IN ('active', 'suspended')),
      authority_role text NOT NULL
        CHECK (authority_role IN ('member', 'reviewer', 'administrator', 'owner')),
      product_tier text NOT NULL CHECK (product_tier <> ''),
      created_at timestamptz NOT NULL,
      updated_at timestamptz NOT NULL,
      UNIQUE (issuer, subject)
    );

    CREATE INDEX memberships_active_owner_idx
      ON access.memberships (id)
      WHERE status = 'active' AND authority_role = 'owner';

    CREATE TABLE access.membership_resource_grants (
      membership_id uuid NOT NULL
        REFERENCES access.memberships (id) ON DELETE CASCADE,
      permission text NOT NULL
        CHECK (permission IN ('library.read', 'library.write', 'review.read', 'review.decide')),
      resource_kind text NOT NULL CHECK (resource_kind <> ''),
      resource_id text,
      UNIQUE NULLS NOT DISTINCT (membership_id, permission, resource_kind, resource_id)
    );

    CREATE TABLE access.audit_events (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      event_kind text NOT NULL
        CHECK (event_kind IN ('access-decision', 'initial-owner-bootstrap', 'authority-role-change')),
      occurred_at timestamptz NOT NULL,
      actor_membership_id uuid,
      target_membership_id uuid,
      outcome text NOT NULL CHECK (outcome <> ''),
      evidence jsonb NOT NULL CHECK (jsonb_typeof(evidence) = 'object'),
      recorded_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX audit_events_occurred_at_idx
      ON access.audit_events (occurred_at DESC, id DESC);

    GRANT USAGE ON SCHEMA access TO place_app;
    GRANT SELECT, INSERT, UPDATE ON TABLE access.memberships TO place_app;
    GRANT SELECT, INSERT, UPDATE, DELETE
      ON TABLE access.membership_resource_grants TO place_app;
    GRANT SELECT, INSERT ON TABLE access.audit_events TO place_app;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA access TO place_app;
  `)
}

export function down(pgm: MigrationBuilder): void {
  pgm.sql('DROP SCHEMA access CASCADE;')
}
