import type { MigrationBuilder } from 'node-pg-migrate'

export function up(pgm: MigrationBuilder): void {
  pgm.sql(`
    ALTER TABLE transfers.connector_capture_manifests
      ADD COLUMN acquisition_kind text CHECK (acquisition_kind IN (
        'documented-api', 'account-export', 'structured-web',
        'browser-network', 'browser-dom', 'manual-capture'
      )),
      ADD COLUMN parser_version text CHECK (length(parser_version) BETWEEN 1 AND 120),
      ADD CONSTRAINT connector_capture_manifest_provenance_shape CHECK (
        (acquisition_kind IS NULL) = (parser_version IS NULL)
      );

    ALTER TABLE transfers.source_snapshots
      ADD COLUMN acquisition_kind text CHECK (acquisition_kind IN (
        'documented-api', 'account-export', 'structured-web',
        'browser-network', 'browser-dom', 'manual-capture'
      )),
      ADD COLUMN parser_version text CHECK (length(parser_version) BETWEEN 1 AND 120),
      ADD CONSTRAINT source_snapshot_provenance_shape CHECK (
        (acquisition_kind IS NULL) = (parser_version IS NULL)
      );

    COMMENT ON COLUMN transfers.source_snapshots.acquisition_kind IS
      'Null only for snapshots accepted before provenance-aware capture; those rows cannot drive automatic Place creation.';
    COMMENT ON COLUMN transfers.source_snapshots.parser_version IS
      'Stable normalizer/parser version bound into new snapshot content digests.';
  `)
}

export function down(pgm: MigrationBuilder): void {
  pgm.sql(`
    ALTER TABLE transfers.source_snapshots
      DROP CONSTRAINT source_snapshot_provenance_shape,
      DROP COLUMN parser_version,
      DROP COLUMN acquisition_kind;
    ALTER TABLE transfers.connector_capture_manifests
      DROP CONSTRAINT connector_capture_manifest_provenance_shape,
      DROP COLUMN parser_version,
      DROP COLUMN acquisition_kind;
  `)
}
