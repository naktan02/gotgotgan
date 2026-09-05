import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import { runner as runMigrations } from 'node-pg-migrate'

import {
  startTransferOperationsPostgresDatabase,
  transferOperationDigest,
  transferOperationEvidence,
  transferOperationId,
} from './transfer-operations-postgres-fixture.mjs'

test('transfer operation migration upgrades legacy outbound data without inventing evidence', {
  timeout: 240_000,
}, async () => {
  const fixture = await startTransferOperationsPostgresDatabase(
    'gotgotgan-transfer-operation-migration',
  )
  const { database, transfersModule } = fixture
  const { at } = transferOperationEvidence

  try {
    const runCurrentUpgradeMigrations = async (direction) => runMigrations({
      dbClient: database.administratorClient,
      dir: fileURLToPath(new URL('../../../migrations', import.meta.url)),
      ignorePattern: 'README.md',
      direction,
      count: 10,
      migrationsTable: 'applied_migrations',
      migrationsSchema: 'place_migrations',
      checkOrder: true,
      singleTransaction: true,
      advisoryLockMode: 'fail',
      logger: { info() {}, warn() {}, error() {} },
    })

    const migration = await database.pool.query(
      `SELECT to_regclass('transfers.operations')::text AS operations,
              to_regclass('transfers.connector_capture_manifests')::text AS manifests,
              to_regclass('transfers.outbound_execution_grants')::text AS outbound_grants,
              EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'transfers' AND table_name = 'connection_observations'
                  AND column_name = 'account_fingerprint'
              ) AS has_account_fingerprint`,
    )
    assert.deepEqual(migration.rows[0], {
      operations: 'transfers.operations',
      manifests: 'transfers.connector_capture_manifests',
      outbound_grants: 'transfers.outbound_execution_grants',
      has_account_fingerprint: true,
    })

    await database.administratorClient.query('SET ROLE place_owner')
    try {
      await runCurrentUpgradeMigrations('down')
      assert.equal((await database.administratorClient.query(
        `SELECT EXISTS (
           SELECT 1 FROM information_schema.columns
           WHERE table_schema = 'transfers' AND table_name = 'outbound_transfer_items'
             AND column_name = 'target_provider_place_id'
         ) AS present`,
      )).rows[0].present, false)

      const legacyMemberId = transferOperationId(10)
      const legacyConnectionId = transferOperationId(11)
      const legacyCollectionId = transferOperationId(12)
      const legacyPlaceId = transferOperationId(13)
      const legacyTransferId = transferOperationId(14)
      const secondLegacyPlaceId = transferOperationId(15)
      const legacyReadyConnectionId = transferOperationId(16)
      const legacyReadyObservationId = transferOperationId(17)
      const legacySnapshotId = transferOperationId(18)
      const legacySourceListId = 'legacy-source-list'
      const legacySourceItemId = 'legacy-source-item'
      await database.administratorClient.query(
        `INSERT INTO access.memberships (
           id, issuer, subject, status, authority_role, product_tier, user_grade,
           created_at, updated_at
         ) VALUES ($1::uuid,'https://identity.example.test','stage10-upgrade','active','member',
           'standard','unclassified',$2::timestamptz,$2::timestamptz)`,
        [legacyMemberId, at],
      )
      await database.administratorClient.query(
        'INSERT INTO places.canonical_places (id) VALUES ($1::uuid),($2::uuid)',
        [legacyPlaceId, secondLegacyPlaceId],
      )
      await database.administratorClient.query(
        `INSERT INTO library.collections (
           id, owner_membership_id, name, visibility, created_at, updated_at
         ) VALUES ($1::uuid,$2::uuid,'업그레이드 목록','private',$3::timestamptz,$3::timestamptz)`,
        [legacyCollectionId, legacyMemberId, at],
      )
      await database.administratorClient.query(
        `INSERT INTO library.collection_places (
           collection_id, canonical_place_id, position, added_at
         ) VALUES ($1::uuid,$2::uuid,0,$3::timestamptz)`,
        [legacyCollectionId, legacyPlaceId, at],
      )
      await database.administratorClient.query(
        `INSERT INTO transfers.provider_connections (
           id, owner_membership_id, provider_key, label, auth_method, state,
           action_required, created_at, updated_at
         ) VALUES ($1::uuid,$2::uuid,'naver','기존 연결','browser-session','action-required',
           'complete-authorization',$3::timestamptz,$3::timestamptz)`,
        [legacyConnectionId, legacyMemberId, at],
      )
      await database.administratorClient.query(
        `INSERT INTO transfers.provider_connections (
           id, owner_membership_id, provider_key, label, auth_method, state,
           action_required, last_verified_at, created_at, updated_at
         ) VALUES ($1::uuid,$2::uuid,'naver','기존 검증 연결','browser-session','ready',
           NULL,$3::timestamptz,$3::timestamptz,$3::timestamptz)`,
        [legacyReadyConnectionId, legacyMemberId, at],
      )
      await database.administratorClient.query(
        `INSERT INTO transfers.connection_observations (
           observation_id, connection_id, expected_connection_revision, observed_state,
           action_required, observed_at, observation_fingerprint
         ) VALUES ($1::uuid,$2::uuid,1,'ready',NULL,$3::timestamptz,$4)`,
        [legacyReadyObservationId, legacyReadyConnectionId, at,
          transferOperationDigest('legacy-observation')],
      )
      await database.administratorClient.query(
        `INSERT INTO transfers.source_snapshots (
           id, owner_membership_id, connection_id, provider_key, source_revision,
           content_digest, observed_at, captured_at
         ) VALUES ($1::uuid,$2::uuid,$3::uuid,'naver','legacy-source-revision',$4,
           $5::timestamptz,$5::timestamptz)`,
        [legacySnapshotId, legacyMemberId, legacyReadyConnectionId,
          transferOperationDigest('legacy-source-snapshot'), at],
      )
      await database.administratorClient.query(
        `INSERT INTO library.collection_import_provenance (
           collection_id, owner_membership_id, provider_key, source_connection_reference,
           source_list_id, source_name_snapshot, source_position,
           first_imported_at, last_imported_at
         ) VALUES ($1::uuid,$2::uuid,'naver',$3::uuid,$4,'기존 원본 목록',0,
           $5::timestamptz,$5::timestamptz)`,
        [legacyCollectionId, legacyMemberId, legacyReadyConnectionId, legacySourceListId, at],
      )
      await database.administratorClient.query(
        `INSERT INTO library.import_source_list_bindings (
           provider_key, source_connection_reference, source_list_id, owner_membership_id,
           collection_id, source_name_snapshot, source_position,
           first_bound_at, last_materialized_at
         ) VALUES ('naver',$1::uuid,$2,$3::uuid,$4::uuid,'기존 원본 목록',0,
           $5::timestamptz,$5::timestamptz)`,
        [legacyReadyConnectionId, legacySourceListId, legacyMemberId, legacyCollectionId, at],
      )
      await database.administratorClient.query(
        `INSERT INTO library.collection_place_import_provenance (
           collection_id, canonical_place_id, provider_key, source_connection_reference,
           source_list_id, source_item_id, provider_place_id,
           first_imported_at, last_imported_at
         ) VALUES ($1::uuid,$2::uuid,'naver',$3::uuid,$4,$5,'legacy-provider-place',
           $6::timestamptz,$6::timestamptz)`,
        [legacyCollectionId, legacyPlaceId, legacyReadyConnectionId,
          legacySourceListId, legacySourceItemId, at],
      )
      await database.administratorClient.query(
        `INSERT INTO transfers.outbound_transfers (
           id, owner_membership_id, connection_id, provider_key, collection_id,
           collection_version, selection_kind, plan_digest, target_kind, target_name,
           state, item_count, created_at, updated_at
         ) VALUES ($1::uuid,$2::uuid,$3::uuid,'naver',$4::uuid,'legacy-revision','all',$5,
           'new-list','기존 미리보기','draft',1,$6::timestamptz,$6::timestamptz)`,
        [legacyTransferId, legacyMemberId, legacyConnectionId, legacyCollectionId,
          transferOperationDigest('legacy-plan'), at],
      )
      await database.administratorClient.query(
        `INSERT INTO transfers.outbound_transfer_items (
           transfer_id, canonical_place_id, source_position, preview_status
         ) VALUES ($1::uuid,$2::uuid,0,'add')`,
        [legacyTransferId, legacyPlaceId],
      )

      await runCurrentUpgradeMigrations('up')
      const upgradedLegacy = (await database.administratorClient.query(
        `SELECT item.preview_status, item.target_provider_place_id,
                constraint_row.convalidated
         FROM transfers.outbound_transfer_items AS item
         CROSS JOIN pg_constraint AS constraint_row
         WHERE item.transfer_id = $1::uuid
           AND constraint_row.conname = 'outbound_transfer_items_target_provider_place_check'`,
        [legacyTransferId],
      )).rows[0]
      assert.deepEqual(upgradedLegacy, {
        preview_status: 'add',
        target_provider_place_id: null,
        convalidated: false,
      })
      assert.deepEqual((await database.administratorClient.query(
        `SELECT source.id AS import_source_id,
                source.source_kind,
                source.connection_id,
                snapshot.import_source_id AS snapshot_import_source_id,
                snapshot.import_source_kind AS snapshot_import_source_kind,
                collection_provenance.import_source_id AS collection_import_source_id,
                collection_provenance.import_source_kind AS collection_import_source_kind,
                collection_provenance.source_connection_reference
                  AS collection_source_connection_reference,
                binding.import_source_id AS binding_import_source_id,
                binding.import_source_kind AS binding_import_source_kind,
                binding.source_connection_reference AS binding_source_connection_reference,
                place_provenance.import_source_id AS place_import_source_id,
                place_provenance.import_source_kind AS place_import_source_kind,
                place_provenance.source_connection_reference AS place_source_connection_reference,
                place_provenance.owner_membership_id AS place_owner_membership_id
         FROM transfers.import_sources AS source
         JOIN transfers.source_snapshots AS snapshot ON snapshot.id = $2::uuid
         JOIN library.collection_import_provenance AS collection_provenance
           ON collection_provenance.collection_id = $3::uuid
         JOIN library.import_source_list_bindings AS binding
           ON binding.provider_key = 'naver'
          AND binding.import_source_id = source.id
          AND binding.source_list_id = $4
         JOIN library.collection_place_import_provenance AS place_provenance
           ON place_provenance.provider_key = 'naver'
          AND place_provenance.import_source_id = source.id
          AND place_provenance.source_list_id = $4
          AND place_provenance.source_item_id = $5
         WHERE source.id = $1::uuid`,
        [legacyReadyConnectionId, legacySnapshotId, legacyCollectionId,
          legacySourceListId, legacySourceItemId],
      )).rows, [{
        import_source_id: legacyReadyConnectionId,
        source_kind: 'verified-connection',
        connection_id: legacyReadyConnectionId,
        snapshot_import_source_id: legacyReadyConnectionId,
        snapshot_import_source_kind: 'verified-connection',
        collection_import_source_id: legacyReadyConnectionId,
        collection_import_source_kind: 'verified-connection',
        collection_source_connection_reference: legacyReadyConnectionId,
        binding_import_source_id: legacyReadyConnectionId,
        binding_import_source_kind: 'verified-connection',
        binding_source_connection_reference: legacyReadyConnectionId,
        place_import_source_id: legacyReadyConnectionId,
        place_import_source_kind: 'verified-connection',
        place_source_connection_reference: legacyReadyConnectionId,
        place_owner_membership_id: legacyMemberId,
      }])
      await assert.rejects(
        database.administratorClient.query(
          `INSERT INTO transfers.outbound_transfer_items (
             transfer_id, canonical_place_id, source_position, preview_status
           ) VALUES ($1::uuid,$2::uuid,1,'add')`,
          [legacyTransferId, secondLegacyPlaceId],
        ),
        { code: '23514' },
      )
      assert.deepEqual((await database.administratorClient.query(
        `SELECT connection.state, observation.account_fingerprint
         FROM transfers.provider_connections AS connection
         JOIN transfers.connection_observations AS observation
           ON observation.connection_id = connection.id
         WHERE connection.id = $1::uuid`,
        [legacyReadyConnectionId],
      )).rows, [{ state: 'ready', account_fingerprint: null }])
    } finally {
      await database.administratorClient.query('RESET ROLE')
    }

    const cutoverTransfers = new transfersModule.PostgresProviderTransfers({
      pool: database.pool,
      collections: {},
    })
    const legacyReadyProjection = (await cutoverTransfers.listConnections(transferOperationId(10)))
      .find((connection) => connection.connectionId === transferOperationId(16))
    assert.equal(legacyReadyProjection?.state, 'action-required')
    assert.equal(legacyReadyProjection?.actionRequired, 'reauthorize')
    assert.deepEqual((await database.pool.query(
      `SELECT
         has_column_privilege(current_user, 'transfers.operations', 'lease_generation', 'UPDATE')
           AS can_fence_leases,
         has_table_privilege(current_user, 'transfers.operations', 'DELETE')
           AS can_delete_operations,
         has_table_privilege(current_user, 'transfers.retention_holds', 'SELECT')
           AS can_read_retention_holds,
         has_table_privilege(current_user, 'transfers.retention_holds', 'DELETE')
           AS can_delete_retention_holds`,
    )).rows, [{
      can_fence_leases: true,
      can_delete_operations: false,
      can_read_retention_holds: false,
      can_delete_retention_holds: false,
    }])
  } finally {
    await fixture.close()
  }
})
