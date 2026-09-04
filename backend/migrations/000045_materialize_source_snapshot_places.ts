import type { MigrationBuilder } from 'node-pg-migrate'

export function up(pgm: MigrationBuilder): void {
  pgm.sql(`
    ALTER TABLE transfers.import_plans
      ADD COLUMN contract_major smallint NOT NULL DEFAULT 2,
      ADD CONSTRAINT import_plans_contract_major_check CHECK (contract_major IN (2, 3));

    ALTER TABLE ingestion.provider_place_detail_observations
      ADD CONSTRAINT provider_place_detail_observations_evidence_unique
        UNIQUE (source_observation_id, place_candidate_id);

    ALTER TABLE transfers.import_plan_items
      ADD COLUMN evidence_source_observation_id uuid,
      ADD COLUMN evidence_place_candidate_id uuid,
      DROP CONSTRAINT import_plan_items_decision_kind_check,
      DROP CONSTRAINT import_plan_items_check,
      ADD CONSTRAINT import_plan_items_decision_kind_check CHECK (decision_kind IN (
        'snapshot-match', 'policy-create', 'link', 'skip', 'none'
      )),
      ADD CONSTRAINT import_plan_items_check CHECK (
        (preview_status IN ('add', 'already-present') AND resolved_place_id IS NOT NULL
          AND decision_kind IN ('snapshot-match', 'link'))
        OR (preview_status = 'add' AND resolved_place_id IS NULL
          AND decision_kind = 'policy-create')
        OR (preview_status = 'unresolved' AND resolved_place_id IS NULL
          AND decision_kind = 'none')
        OR (preview_status = 'skipped' AND resolved_place_id IS NULL
          AND decision_kind = 'skip')
      ),
      ADD CONSTRAINT import_plan_items_policy_create_evidence_check CHECK (
        (decision_kind = 'policy-create'
          AND evidence_source_observation_id IS NOT NULL
          AND evidence_place_candidate_id IS NOT NULL)
        OR (decision_kind <> 'policy-create'
          AND evidence_source_observation_id IS NULL
          AND evidence_place_candidate_id IS NULL)
      ),
      ADD CONSTRAINT import_plan_items_detail_evidence_fk
        FOREIGN KEY (evidence_source_observation_id, evidence_place_candidate_id)
        REFERENCES ingestion.provider_place_detail_observations (
          source_observation_id, place_candidate_id
        );

    CREATE TRIGGER import_plan_item_evidence_requires_draft
      BEFORE UPDATE OF evidence_source_observation_id, evidence_place_candidate_id
      ON transfers.import_plan_items
      FOR EACH ROW EXECUTE FUNCTION transfers.guard_import_plan_item_decision();

    GRANT UPDATE (canonical_place_id) ON transfers.operation_items TO place_app;
    GRANT UPDATE (evidence_source_observation_id, evidence_place_candidate_id)
      ON transfers.import_plan_items TO place_app;
  `)
}

export function down(pgm: MigrationBuilder): void {
  pgm.sql(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM transfers.import_plan_items WHERE decision_kind = 'policy-create'
      ) THEN
        RAISE EXCEPTION 'cannot remove policy-create while import plans still use it';
      END IF;
      IF EXISTS (
        SELECT 1 FROM transfers.import_plans WHERE contract_major <> 2
      ) THEN
        RAISE EXCEPTION 'cannot remove import plan contract major while v3 plans still exist';
      END IF;
    END $$;

    REVOKE UPDATE (canonical_place_id) ON transfers.operation_items FROM place_app;
    REVOKE UPDATE (evidence_source_observation_id, evidence_place_candidate_id)
      ON transfers.import_plan_items FROM place_app;
    DROP TRIGGER import_plan_item_evidence_requires_draft
      ON transfers.import_plan_items;
    ALTER TABLE transfers.import_plan_items
      DROP CONSTRAINT import_plan_items_detail_evidence_fk,
      DROP CONSTRAINT import_plan_items_policy_create_evidence_check,
      DROP CONSTRAINT import_plan_items_decision_kind_check,
      DROP CONSTRAINT import_plan_items_check,
      ADD CONSTRAINT import_plan_items_decision_kind_check CHECK (decision_kind IN (
        'snapshot-match', 'link', 'skip', 'none'
      )),
      ADD CONSTRAINT import_plan_items_check CHECK (
        (preview_status IN ('add', 'already-present') AND resolved_place_id IS NOT NULL
          AND decision_kind IN ('snapshot-match', 'link'))
        OR (preview_status = 'unresolved' AND resolved_place_id IS NULL AND decision_kind = 'none')
        OR (preview_status = 'skipped' AND resolved_place_id IS NULL AND decision_kind = 'skip')
      ),
      DROP COLUMN evidence_place_candidate_id,
      DROP COLUMN evidence_source_observation_id;

    ALTER TABLE ingestion.provider_place_detail_observations
      DROP CONSTRAINT provider_place_detail_observations_evidence_unique;

    ALTER TABLE transfers.import_plans
      DROP CONSTRAINT import_plans_contract_major_check,
      DROP COLUMN contract_major;
  `)
}
