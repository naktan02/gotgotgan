import type { MigrationBuilder } from 'node-pg-migrate'

export function up(pgm: MigrationBuilder): void {
  pgm.sql(`
    CREATE OR REPLACE FUNCTION transfers.assert_operation_resource_binding()
    RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.resource_kind = 'snapshot' AND NOT EXISTS (
        SELECT 1 FROM transfers.connector_capture_manifests AS manifest
        WHERE manifest.manifest_id = NEW.resource_id AND manifest.operation_id = NEW.id
          AND manifest.owner_membership_id = NEW.owner_membership_id
          AND NEW.kind = 'import-capture' AND manifest.provider_key = NEW.provider_key
          AND manifest.connection_id = NEW.connection_id
      ) THEN RAISE EXCEPTION 'snapshot operation resource binding is invalid'; END IF;
      IF NEW.resource_kind = 'import-plan' AND NOT EXISTS (
        SELECT 1 FROM transfers.import_plans AS plan
        JOIN transfers.source_snapshots AS snapshot ON snapshot.id = plan.snapshot_id
        WHERE plan.id = NEW.resource_id AND plan.operation_id = NEW.id
          AND plan.owner_membership_id = NEW.owner_membership_id
          AND NEW.kind = 'import-materialization' AND snapshot.provider_key = NEW.provider_key
          AND snapshot.import_source_id = NEW.import_source_id
          AND snapshot.import_source_kind = NEW.import_source_kind
          AND snapshot.connection_id IS NOT DISTINCT FROM NEW.connection_id
      ) THEN RAISE EXCEPTION 'import operation resource binding is invalid'; END IF;
      IF NEW.resource_kind = 'outbound-transfer' AND NOT EXISTS (
        SELECT 1 FROM transfers.outbound_transfers AS transfer
        WHERE transfer.id = NEW.resource_id AND transfer.operation_id = NEW.id
          AND transfer.owner_membership_id = NEW.owner_membership_id
          AND NEW.kind = 'outbound-transfer' AND transfer.provider_key = NEW.provider_key
          AND transfer.connection_id = NEW.connection_id
      ) THEN RAISE EXCEPTION 'outbound operation resource binding is invalid'; END IF;
      IF NEW.resource_kind = 'membership-erasure' AND NEW.kind <> 'account-erasure' THEN
        RAISE EXCEPTION 'membership erasure operation kind is invalid';
      END IF;
      RETURN NEW;
    END $$;

    CREATE OR REPLACE FUNCTION transfers.assert_resource_operation_binding()
    RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE row_data jsonb;
    BEGIN
      row_data := to_jsonb(NEW);
      IF TG_TABLE_NAME = 'connector_capture_manifests' AND NOT EXISTS (
        SELECT 1 FROM transfers.operations AS operation
        WHERE operation.id = (row_data->>'operation_id')::uuid
          AND operation.resource_kind = 'snapshot'
          AND operation.resource_id = (row_data->>'manifest_id')::uuid
          AND operation.kind = 'import-capture'
          AND operation.owner_membership_id = (row_data->>'owner_membership_id')::uuid
          AND operation.provider_key = row_data->>'provider_key'
          AND operation.connection_id = (row_data->>'connection_id')::uuid
      ) THEN RAISE EXCEPTION 'capture resource operation binding is invalid'; END IF;
      IF TG_TABLE_NAME = 'import_plans' AND row_data->>'operation_id' IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM transfers.operations AS operation
        JOIN transfers.source_snapshots AS snapshot
          ON snapshot.id = (row_data->>'snapshot_id')::uuid
        WHERE operation.id = (row_data->>'operation_id')::uuid
          AND operation.resource_kind = 'import-plan'
          AND operation.resource_id = (row_data->>'id')::uuid
          AND operation.kind = 'import-materialization'
          AND operation.owner_membership_id = (row_data->>'owner_membership_id')::uuid
          AND operation.provider_key = snapshot.provider_key
          AND operation.import_source_id = snapshot.import_source_id
          AND operation.import_source_kind = snapshot.import_source_kind
          AND operation.connection_id IS NOT DISTINCT FROM snapshot.connection_id
      ) THEN RAISE EXCEPTION 'import resource operation binding is invalid'; END IF;
      IF TG_TABLE_NAME = 'outbound_transfers' AND row_data->>'operation_id' IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM transfers.operations AS operation
        WHERE operation.id = (row_data->>'operation_id')::uuid
          AND operation.resource_kind = 'outbound-transfer'
          AND operation.resource_id = (row_data->>'id')::uuid
          AND operation.kind = 'outbound-transfer'
          AND operation.owner_membership_id = (row_data->>'owner_membership_id')::uuid
          AND operation.provider_key = row_data->>'provider_key'
          AND operation.connection_id = (row_data->>'connection_id')::uuid
      ) THEN RAISE EXCEPTION 'outbound resource operation binding is invalid'; END IF;
      RETURN NEW;
    END $$;

    DROP TRIGGER transfer_operation_resource_binding ON transfers.operations;
    CREATE CONSTRAINT TRIGGER transfer_operation_resource_binding
      AFTER INSERT OR UPDATE OF resource_kind, resource_id, owner_membership_id, kind,
        provider_key, import_source_id, import_source_kind, connection_id
      ON transfers.operations DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION transfers.assert_operation_resource_binding();
  `)
}

export function down(pgm: MigrationBuilder): void {
  pgm.sql(`
    CREATE OR REPLACE FUNCTION transfers.assert_operation_resource_binding()
    RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.resource_kind = 'snapshot' AND NOT EXISTS (
        SELECT 1 FROM transfers.connector_capture_manifests AS manifest
        WHERE manifest.manifest_id = NEW.resource_id AND manifest.operation_id = NEW.id
          AND manifest.owner_membership_id = NEW.owner_membership_id
          AND NEW.kind = 'import-capture' AND manifest.provider_key = NEW.provider_key
          AND manifest.connection_id = NEW.connection_id
      ) THEN RAISE EXCEPTION 'snapshot operation resource binding is invalid'; END IF;
      IF NEW.resource_kind = 'import-plan' AND NOT EXISTS (
        SELECT 1 FROM transfers.import_plans AS plan
        JOIN transfers.source_snapshots AS snapshot ON snapshot.id = plan.snapshot_id
        WHERE plan.id = NEW.resource_id AND plan.operation_id = NEW.id
          AND plan.owner_membership_id = NEW.owner_membership_id
          AND NEW.kind = 'import-materialization' AND snapshot.provider_key = NEW.provider_key
          AND snapshot.connection_id = NEW.connection_id
      ) THEN RAISE EXCEPTION 'import operation resource binding is invalid'; END IF;
      IF NEW.resource_kind = 'outbound-transfer' AND NOT EXISTS (
        SELECT 1 FROM transfers.outbound_transfers AS transfer
        WHERE transfer.id = NEW.resource_id AND transfer.operation_id = NEW.id
          AND transfer.owner_membership_id = NEW.owner_membership_id
          AND NEW.kind = 'outbound-transfer' AND transfer.provider_key = NEW.provider_key
          AND transfer.connection_id = NEW.connection_id
      ) THEN RAISE EXCEPTION 'outbound operation resource binding is invalid'; END IF;
      IF NEW.resource_kind = 'membership-erasure' AND NEW.kind <> 'account-erasure' THEN
        RAISE EXCEPTION 'membership erasure operation kind is invalid';
      END IF;
      RETURN NEW;
    END $$;

    CREATE OR REPLACE FUNCTION transfers.assert_resource_operation_binding()
    RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE row_data jsonb;
    BEGIN
      row_data := to_jsonb(NEW);
      IF TG_TABLE_NAME = 'connector_capture_manifests' AND NOT EXISTS (
        SELECT 1 FROM transfers.operations AS operation
        WHERE operation.id = (row_data->>'operation_id')::uuid
          AND operation.resource_kind = 'snapshot'
          AND operation.resource_id = (row_data->>'manifest_id')::uuid
          AND operation.kind = 'import-capture'
          AND operation.owner_membership_id = (row_data->>'owner_membership_id')::uuid
          AND operation.provider_key = row_data->>'provider_key'
          AND operation.connection_id = (row_data->>'connection_id')::uuid
      ) THEN RAISE EXCEPTION 'capture resource operation binding is invalid'; END IF;
      IF TG_TABLE_NAME = 'import_plans' AND row_data->>'operation_id' IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM transfers.operations AS operation
        JOIN transfers.source_snapshots AS snapshot
          ON snapshot.id = (row_data->>'snapshot_id')::uuid
        WHERE operation.id = (row_data->>'operation_id')::uuid
          AND operation.resource_kind = 'import-plan'
          AND operation.resource_id = (row_data->>'id')::uuid
          AND operation.kind = 'import-materialization'
          AND operation.owner_membership_id = (row_data->>'owner_membership_id')::uuid
          AND operation.provider_key = snapshot.provider_key
          AND operation.connection_id = snapshot.connection_id
      ) THEN RAISE EXCEPTION 'import resource operation binding is invalid'; END IF;
      IF TG_TABLE_NAME = 'outbound_transfers' AND row_data->>'operation_id' IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM transfers.operations AS operation
        WHERE operation.id = (row_data->>'operation_id')::uuid
          AND operation.resource_kind = 'outbound-transfer'
          AND operation.resource_id = (row_data->>'id')::uuid
          AND operation.kind = 'outbound-transfer'
          AND operation.owner_membership_id = (row_data->>'owner_membership_id')::uuid
          AND operation.provider_key = row_data->>'provider_key'
          AND operation.connection_id = (row_data->>'connection_id')::uuid
      ) THEN RAISE EXCEPTION 'outbound resource operation binding is invalid'; END IF;
      RETURN NEW;
    END $$;

    DROP TRIGGER transfer_operation_resource_binding ON transfers.operations;
    CREATE CONSTRAINT TRIGGER transfer_operation_resource_binding
      AFTER INSERT OR UPDATE OF resource_kind, resource_id, owner_membership_id, kind,
        provider_key, connection_id
      ON transfers.operations DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION transfers.assert_operation_resource_binding();
  `)
}
