import type { MigrationBuilder } from 'node-pg-migrate'

export function up(pgm: MigrationBuilder): void {
  pgm.sql(`
    ALTER TABLE access.membership_resource_grants
      DROP CONSTRAINT membership_resource_grants_permission_check;

    ALTER TABLE access.membership_resource_grants
      ADD CONSTRAINT membership_resource_grants_permission_check
      CHECK (permission IN (
        'library.read',
        'library.write',
        'library.share',
        'review.read',
        'review.decide'
      ));
  `)
}

export function down(pgm: MigrationBuilder): void {
  pgm.sql(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM access.membership_resource_grants
        WHERE permission = 'library.share'
      ) THEN
        RAISE EXCEPTION 'library.share grants must be removed before rolling back migration 000029';
      END IF;
    END
    $$;

    ALTER TABLE access.membership_resource_grants
      DROP CONSTRAINT membership_resource_grants_permission_check;

    ALTER TABLE access.membership_resource_grants
      ADD CONSTRAINT membership_resource_grants_permission_check
      CHECK (permission IN ('library.read', 'library.write', 'review.read', 'review.decide'));
  `)
}
