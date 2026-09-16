import assert from 'node:assert/strict'
import test from 'node:test'

import { startPreparedPlaceDatabase } from '../support/prepared-place-database.mjs'

const memberId = '01994900-0000-7000-8000-000000000001'
const otherMemberId = '01994900-0000-7000-8000-000000000002'
const importSourceId = '01994900-0000-7000-8000-000000000003'
const snapshotId = '01994900-0000-7000-8000-000000000004'
const collectionId = '01994900-0000-7000-8000-000000000005'
const placeId = '01994900-0000-7000-8000-000000000006'
const connectionId = '01994900-0000-7000-8000-000000000007'
const connectionCommandId = '01994900-0000-7000-8000-000000000008'
const connectionObservationId = '01994900-0000-7000-8000-000000000009'
const connectedSnapshotId = '01994900-0000-7000-8000-000000000010'
const otherImportSourceId = '01994900-0000-7000-8000-000000000011'
const at = '2026-09-05T01:00:00.000Z'

test('one-shot import identity is durable without impersonating a provider connection', {
  timeout: 120_000,
}, async () => {
  const database = await startPreparedPlaceDatabase('gotgotgan-import-source-identity')
  try {
    const { PostgresProviderTransfers } = await import('../../../dist/modules/transfers/index.js')
    await database.pool.query(
      `INSERT INTO access.memberships (
         id, issuer, subject, status, authority_role, product_tier, user_grade,
         created_at, updated_at
       ) VALUES
         ($1::uuid,'https://identity.example.test','import-source-owner','active','member',
          'standard','unclassified',$3::timestamptz,$3::timestamptz),
         ($2::uuid,'https://identity.example.test','import-source-other','active','member',
          'standard','unclassified',$3::timestamptz,$3::timestamptz)`,
      [memberId, otherMemberId, at],
    )
    await database.pool.query(
      `INSERT INTO transfers.import_sources (
         id, owner_membership_id, provider_key, source_kind,
         connection_id, acquisition_method, authorization_basis, created_at
       ) VALUES ($1::uuid,$2::uuid,'naver','one-shot',NULL,
         'shared-link','link-possession',$3::timestamptz)`,
      [importSourceId, memberId, at],
    )
    await database.pool.query(
      `INSERT INTO transfers.import_sources (
         id, owner_membership_id, provider_key, source_kind,
         connection_id, acquisition_method, authorization_basis, created_at
       ) VALUES ($1::uuid,$2::uuid,'naver','one-shot',NULL,
         'shared-link','link-possession',$3::timestamptz)`,
      [otherImportSourceId, otherMemberId, at],
    )
    const transfers = new PostgresProviderTransfers({
      pool: database.pool,
      collections: {},
      enabledConnectionAuthMethods: { naver: ['browser-session'] },
      now: () => new Date(at),
    })
    const captured = await transfers.recordSourceSnapshotV3({
      snapshotId,
      ownerMemberId: memberId,
      providerKey: 'naver',
      source: {
        kind: 'one-shot',
        importSourceId,
        acquisitionMethod: 'shared-link',
        authorizationBasis: 'link-possession',
        accountAssurance: 'unverified',
      },
      sourceRevision: 'shared-list-r1',
      provenance: { acquisitionKind: 'structured-web', parserVersion: 'naver-shared-list.v1' },
      observedAt: at,
      capturedAt: at,
      lists: [{
        sourceListId: 'shared-list',
        observedName: '공유 목록',
        sourcePosition: 0,
        items: [{
          sourceItemId: 'item-1',
          providerPlaceId: 'naver-place-1',
          observedName: '공유 장소',
          observedAddress: null,
          observedCategory: null,
          observedLocation: null,
          match: { status: 'unresolved', reason: 'missing-identity' },
          sourcePosition: 0,
        }],
      }],
    })
    assert.equal(captured.status, 'applied')
    assert.equal(captured.snapshot.schemaVersion, 'source-snapshot-detail.v3')
    assert.equal(captured.snapshot.source.accountAssurance, 'unverified')
    assert.deepEqual(await transfers.getSnapshotV3(memberId, snapshotId), captured.snapshot)

    const createdConnection = await transfers.applyConnectionCommand(memberId, {
      schemaVersion: 'provider-connection-command.v2',
      kind: 'create',
      commandId: connectionCommandId,
      connectionId,
      providerKey: 'naver',
      label: '검증된 네이버',
      authMethod: 'browser-session',
    })
    const verifiedConnection = await transfers.recordConnectionObservation({
      observationId: connectionObservationId,
      ownerMemberId: memberId,
      connectionId,
      expectedConnectionRevision: createdConnection.value.connectionRevision,
      observedState: 'ready',
      accountFingerprint: 'a'.repeat(64),
      observedAt: at,
    })
    assert.equal(verifiedConnection.status, 'applied')
    const connectedCapture = await transfers.recordSourceSnapshot({
      snapshotId: connectedSnapshotId,
      ownerMemberId: memberId,
      connectionId,
      providerKey: 'naver',
      sourceRevision: 'connected-r1',
      provenance: { acquisitionKind: 'browser-network', parserVersion: 'test-naver.v1' },
      observedAt: at,
      capturedAt: at,
      lists: [],
    })
    assert.equal(connectedCapture.status, 'applied')
    assert.deepEqual((await transfers.getSnapshotV3(memberId, connectedSnapshotId)).source, {
      kind: 'verified-connection',
      importSourceId: connectionId,
      connectionId,
      accountAssurance: 'verified',
    })
    const sourceAwareList = await transfers.listSnapshotsV3({ memberId, limit: 20 })
    assert.equal(sourceAwareList.schemaVersion, 'source-snapshot-list.v3')
    assert.deepEqual(
      new Set(sourceAwareList.items.map((item) => item.source.kind)),
      new Set(['verified-connection', 'one-shot']),
    )
    assert.deepEqual(
      (await transfers.listSnapshotsV3({ memberId, importSourceId, limit: 20 })).items
        .map((item) => item.snapshotId),
      [snapshotId],
    )
    await assert.rejects(
      transfers.listSnapshotsV3({ memberId, cursor: 'invalid', limit: 20 }),
      { name: 'InvalidTransferCursorError' },
    )
    await database.pool.query(
      'INSERT INTO places.canonical_places (id) VALUES ($1::uuid)',
      [placeId],
    )
    await database.pool.query(
      `INSERT INTO library.collections (
         id, owner_membership_id, name, description, visibility, publication_id,
         created_at, updated_at
       ) VALUES ($1::uuid,$2::uuid,'가져온 공유 목록',NULL,'private',NULL,
         $3::timestamptz,$3::timestamptz)`,
      [collectionId, memberId, at],
    )
    await database.pool.query(
      `INSERT INTO library.collection_places (
         collection_id, canonical_place_id, position, added_at
       ) VALUES ($1::uuid,$2::uuid,0,$3::timestamptz)`,
      [collectionId, placeId, at],
    )
    await database.pool.query(
      `INSERT INTO library.import_source_list_bindings (
         provider_key, import_source_id, import_source_kind, source_connection_reference,
         source_list_id, owner_membership_id, collection_id, source_name_snapshot,
         source_position, binding_revision, first_bound_at, last_materialized_at
       ) VALUES ('naver',$1::uuid,'one-shot',NULL,'shared-list',$2::uuid,$3::uuid,
         '공유 목록',0,1,$4::timestamptz,$4::timestamptz)`,
      [importSourceId, memberId, collectionId, at],
    )
    await database.pool.query(
      `INSERT INTO library.collection_place_import_provenance (
         collection_id, canonical_place_id, provider_key,
         import_source_id, import_source_kind, source_connection_reference,
         owner_membership_id, source_list_id, source_item_id, provider_place_id,
         first_imported_at, last_imported_at
       ) VALUES ($1::uuid,$2::uuid,'naver',$3::uuid,'one-shot',NULL,$4::uuid,
         'shared-list','item-1','naver-place-1',$5::timestamptz,$5::timestamptz)`,
      [collectionId, placeId, importSourceId, memberId, at],
    )

    assert.deepEqual((await database.pool.query(
      `SELECT source_kind, connection_id, acquisition_method, authorization_basis
       FROM transfers.import_sources WHERE id = $1::uuid`,
      [importSourceId],
    )).rows, [{
      source_kind: 'one-shot',
      connection_id: null,
      acquisition_method: 'shared-link',
      authorization_basis: 'link-possession',
    }])
    assert.deepEqual((await database.pool.query(
      `SELECT import_source_kind, connection_id
       FROM transfers.source_snapshots WHERE id = $1::uuid`,
      [snapshotId],
    )).rows, [{ import_source_kind: 'one-shot', connection_id: null }])
    assert.equal(await transfers.getSnapshot(memberId, snapshotId), undefined)
    assert.equal((await transfers.getSnapshot(memberId, connectedSnapshotId)).connectionId,
      connectionId)

    await assert.rejects(
      database.pool.query(
        `INSERT INTO library.import_source_list_bindings (
           provider_key, import_source_id, import_source_kind, source_connection_reference,
           source_list_id, owner_membership_id, collection_id, source_name_snapshot,
           source_position, binding_revision, first_bound_at, last_materialized_at
         ) VALUES ('naver',$1::uuid,'one-shot',$1::uuid,'forged-list',$2::uuid,$3::uuid,
           '위조 연결',1,1,$4::timestamptz,$4::timestamptz)`,
        [importSourceId, memberId, collectionId, at],
      ),
      (error) => error.code === '23514',
    )
    await assert.rejects(
      database.pool.query(
        `INSERT INTO library.import_source_list_bindings (
           provider_key, import_source_id, import_source_kind, source_connection_reference,
           source_list_id, owner_membership_id, collection_id, source_name_snapshot,
           source_position, binding_revision, first_bound_at, last_materialized_at
         ) VALUES ('naver',$1::uuid,'one-shot',NULL,'cross-owner',$2::uuid,$3::uuid,
           '타인 소유',1,1,$4::timestamptz,$4::timestamptz)`,
        [importSourceId, otherMemberId, collectionId, at],
      ),
      (error) => error.code === '23503',
    )
    await assert.rejects(
      database.pool.query(
        `INSERT INTO library.collection_place_import_provenance (
           collection_id, canonical_place_id, provider_key,
           import_source_id, import_source_kind, source_connection_reference,
           owner_membership_id, source_list_id, source_item_id, provider_place_id,
           first_imported_at, last_imported_at
         ) VALUES ($1::uuid,$2::uuid,'naver',$3::uuid,'one-shot',NULL,$4::uuid,
           'other-list','other-item','other-provider-place',$5::timestamptz,$5::timestamptz)`,
        [collectionId, placeId, otherImportSourceId, otherMemberId, at],
      ),
      (error) => error.code === '23503',
    )
  } finally {
    await database.close()
  }
})
