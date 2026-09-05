import type { MigrationBuilder } from 'node-pg-migrate'

export function up(pgm: MigrationBuilder): void {
  pgm.sql(`
    ALTER TABLE transfers.import_plan_items
      ADD COLUMN evidence_snapshot_id uuid,
      DROP CONSTRAINT import_plan_items_policy_create_evidence_check,
      ADD CONSTRAINT import_plan_items_policy_create_evidence_check CHECK (
        (decision_kind = 'policy-create' AND (
          (evidence_snapshot_id IS NULL AND evidence_source_observation_id IS NOT NULL
            AND evidence_place_candidate_id IS NOT NULL)
          OR (evidence_snapshot_id IS NOT NULL AND evidence_source_observation_id IS NULL
            AND evidence_place_candidate_id IS NULL)
        ))
        OR (decision_kind <> 'policy-create' AND evidence_snapshot_id IS NULL
          AND evidence_source_observation_id IS NULL AND evidence_place_candidate_id IS NULL)
      ),
      ADD CONSTRAINT import_plan_items_snapshot_plan_evidence_fk
        FOREIGN KEY (plan_id, evidence_snapshot_id)
        REFERENCES transfers.import_plans (id, snapshot_id),
      ADD CONSTRAINT import_plan_items_snapshot_item_evidence_fk
        FOREIGN KEY (evidence_snapshot_id, source_list_id, source_item_id)
        REFERENCES transfers.source_snapshot_items (snapshot_id, source_list_id, source_item_id);

    CREATE TRIGGER import_plan_item_snapshot_evidence_requires_draft
      BEFORE UPDATE OF evidence_snapshot_id ON transfers.import_plan_items
      FOR EACH ROW EXECUTE FUNCTION transfers.guard_import_plan_item_decision();
    GRANT UPDATE (evidence_snapshot_id) ON transfers.import_plan_items TO place_app;
    CREATE INDEX operation_items_member_import_place
      ON transfers.operation_items (canonical_place_id, operation_id)
      WHERE canonical_place_id IS NOT NULL AND status IN ('applied','already-present');
  `)
}

export function down(pgm: MigrationBuilder): void {
  pgm.sql(`
    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM transfers.import_plan_items WHERE evidence_snapshot_id IS NOT NULL)
      THEN RAISE EXCEPTION 'cannot remove snapshot evidence while import plans use it'; END IF;
    END $$;
    REVOKE UPDATE (evidence_snapshot_id) ON transfers.import_plan_items FROM place_app;
    DROP INDEX transfers.operation_items_member_import_place;
    DROP TRIGGER import_plan_item_snapshot_evidence_requires_draft ON transfers.import_plan_items;
    ALTER TABLE transfers.import_plan_items
      DROP CONSTRAINT import_plan_items_snapshot_item_evidence_fk,
      DROP CONSTRAINT import_plan_items_snapshot_plan_evidence_fk,
      DROP CONSTRAINT import_plan_items_policy_create_evidence_check,
      DROP COLUMN evidence_snapshot_id,
      ADD CONSTRAINT import_plan_items_policy_create_evidence_check CHECK (
        (decision_kind = 'policy-create' AND evidence_source_observation_id IS NOT NULL
          AND evidence_place_candidate_id IS NOT NULL)
        OR (decision_kind <> 'policy-create' AND evidence_source_observation_id IS NULL
          AND evidence_place_candidate_id IS NULL)
      );
  `)
}
