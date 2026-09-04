import type { MigrationBuilder } from 'node-pg-migrate'

export function up(pgm: MigrationBuilder): void {
  pgm.sql(`
    CREATE OR REPLACE FUNCTION transfers.guard_import_plan_item_decision()
    RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE plan_state text;
    BEGIN
      SELECT state INTO plan_state
      FROM transfers.import_plans
      WHERE id = NEW.plan_id
      FOR UPDATE;
      IF plan_state <> 'draft' THEN
        RAISE EXCEPTION 'approved import plan items are immutable';
      END IF;
      RETURN NEW;
    END $$;
  `)
}

export function down(pgm: MigrationBuilder): void {
  pgm.sql(`
    CREATE OR REPLACE FUNCTION transfers.guard_import_plan_item_decision()
    RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE plan_state text;
    BEGIN
      SELECT state INTO plan_state FROM transfers.import_plans WHERE id = NEW.plan_id;
      IF plan_state <> 'draft' THEN
        RAISE EXCEPTION 'approved import plan items are immutable';
      END IF;
      RETURN NEW;
    END $$;
  `)
}
