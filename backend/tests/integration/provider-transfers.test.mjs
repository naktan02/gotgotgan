import assert from 'node:assert/strict'
import test from 'node:test'

import { startPreparedPlaceDatabase } from './support/prepared-place-database.mjs'

const memberId = '01992d41-0000-7000-8000-000000000001'
const otherMemberId = '01992d41-0000-7000-8000-000000000002'
const connectionId = '01992d41-0000-7000-8000-000000000003'
const snapshotId = '01992d41-0000-7000-8000-000000000004'
const planId = '01992d41-0000-7000-8000-000000000005'
const collectionId = '01992d41-0000-7000-8000-000000000006'
const placeId = '01992d41-0000-7000-8000-000000000007'
const transferId = '01992d41-0000-7000-8000-000000000008'
const approvedTransferId = '01992d41-0000-7000-8000-000000000009'
const secondSnapshotId = '01992d41-0000-7000-8000-000000000010'
const secondPlanId = '01992d41-0000-7000-8000-000000000011'
const secondPlaceId = '01992d41-0000-7000-8000-000000000012'
const thirdPlaceId = '01992d41-0000-7000-8000-000000000013'
const at = '2026-09-03T01:00:00.000Z'

test('provider transfers require immutable snapshots and explicit approval', { timeout: 120_000 }, async () => {
  const database = await startPreparedPlaceDatabase('gotgotgan-provider-transfers')
  try {
    const library = await import('../../dist/modules/library/index.js')
    const transfersModule = await import('../../dist/modules/transfers/index.js')
    await database.pool.query(
      `INSERT INTO access.memberships (
         id, issuer, subject, status, authority_role, product_tier, user_grade,
         created_at, updated_at
       ) VALUES
         ($1,'https://identity.example.test','transfer-owner','active','member','standard',
          'unclassified',$3::timestamptz,$3::timestamptz),
         ($2,'https://identity.example.test','other-owner','active','member','standard',
          'unclassified',$3::timestamptz,$3::timestamptz)`,
      [memberId, otherMemberId, at],
    )
    await database.pool.query('INSERT INTO places.canonical_places (id) VALUES ($1::uuid)', [placeId])

    const transfers = new transfersModule.PostgresProviderTransfers({
      pool: database.pool,
      materializer: new library.PostgresImportedCollectionMaterializer(database.pool),
      collections: new library.PostgresCollectionTransferReader(database.pool),
      enabledConnectionAuthMethods: { naver: ['browser-session'] },
      now: () => new Date(at),
    })

    const capabilities = await transfers.listCapabilities()
    assert.deepEqual(capabilities.find((item) => item.providerKey === 'naver').connections, {
      availability: 'available', multipleAccounts: true, authMethods: ['browser-session'],
    })
    assert.deepEqual(capabilities.find((item) => item.providerKey === 'google').connections, {
      availability: 'unavailable', multipleAccounts: true, authMethods: [],
    })

    const createConnection = {
      schemaVersion: 'provider-connection-command.v2',
      kind: 'create',
      commandId: '01992d41-0000-7000-8000-000000000101',
      connectionId,
      providerKey: 'naver',
      label: '개인 네이버',
      authMethod: 'browser-session',
    }
    const created = await transfers.applyConnectionCommand(memberId, createConnection)
    assert.equal(created.status, 'applied')
    assert.equal(created.value.state, 'action-required')
    assert.equal((await transfers.applyConnectionCommand(memberId, createConnection)).status, 'replayed')
    const reused = await transfers.applyConnectionCommand(memberId, {
      ...createConnection, label: '다른 연결',
    })
    assert.deepEqual(reused.rejection, { code: 'command-id-reused' })

    const verified = await transfers.recordConnectionObservation({
      observationId: '01992d41-0000-7000-8000-000000000102',
      ownerMemberId: memberId,
      connectionId,
      expectedConnectionRevision: created.value.connectionRevision,
      observedState: 'ready',
      observedAt: '2026-09-03T01:00:01.000Z',
    })
    assert.equal(verified.status, 'applied')
    assert.equal(verified.value.state, 'ready')
    assert.equal(verified.value.lastVerifiedAt, '2026-09-03T01:00:01.000Z')

    const recorded = await transfers.recordSourceSnapshot({
      snapshotId,
      ownerMemberId: memberId,
      connectionId,
      providerKey: 'naver',
      sourceRevision: 'naver-library-42',
      observedAt: '2026-09-03T01:00:02.000Z',
      capturedAt: '2026-09-03T01:00:03.000Z',
      lists: [{
        sourceListId: 'ramen-list',
        observedName: '서울 라멘',
        sourcePosition: 0,
        items: [{
          sourceItemId: 'saved-1', providerPlaceId: 'naver-place-1',
          observedName: '라멘집', observedAddress: '서울시', observedCategory: '라멘',
          observedLocation: { latitude: 37.5, longitude: 127.0 },
          match: { status: 'matched', placeId }, sourcePosition: 0,
        }, {
          sourceItemId: 'saved-2', providerPlaceId: null,
          observedName: '확인 필요 장소', observedAddress: null, observedCategory: null,
          observedLocation: null,
          match: { status: 'unresolved', reason: 'missing-identity' }, sourcePosition: 1,
        }],
      }],
    })
    assert.equal(recorded.status, 'applied')
    assert.equal((await transfers.recordSourceSnapshot({
      snapshotId,
      ownerMemberId: memberId,
      connectionId,
      providerKey: 'naver',
      sourceRevision: 'naver-library-42',
      observedAt: '2026-09-03T01:00:02.000Z',
      capturedAt: '2026-09-03T01:00:03.000Z',
      lists: recorded.snapshot.lists.map((list) => ({
        sourceListId: list.sourceListId, observedName: list.observedName,
        sourcePosition: list.sourcePosition, items: list.items,
      })),
    })).status, 'replayed')
    await assert.rejects(
      transfers.recordSourceSnapshot({
        snapshotId,
        ownerMemberId: memberId,
        connectionId,
        providerKey: 'naver',
        sourceRevision: 'naver-library-42',
        observedAt: '2026-09-03T01:00:02.000Z',
        capturedAt: '2026-09-03T01:00:04.000Z',
        lists: recorded.snapshot.lists.map((list) => ({
          sourceListId: list.sourceListId, observedName: list.observedName,
          sourcePosition: list.sourcePosition, items: list.items,
        })),
      }),
      /snapshot identity reused/,
    )
    await assert.rejects(
      database.pool.query(
        `UPDATE transfers.source_snapshot_items SET observed_name = 'tampered'
         WHERE snapshot_id = $1::uuid`,
        [snapshotId],
      ),
      /permission denied/i,
    )
    await assert.rejects(
      database.pool.query(
        `INSERT INTO transfers.source_snapshots (
           id, owner_membership_id, connection_id, provider_key, source_revision,
           content_digest, observed_at, captured_at
         ) VALUES (
           '01992d41-0000-7000-8000-000000000099',$1::uuid,$2::uuid,'naver','bad-owner',
           repeat('a',64),$3::timestamptz,$3::timestamptz
         )`,
        [otherMemberId, connectionId, at],
      ),
      /foreign key/i,
    )

    const createdPlan = await transfers.applyImportPlanCommand(memberId, {
      schemaVersion: 'import-plan-command.v2', kind: 'create',
      commandId: '01992d41-0000-7000-8000-000000000103',
      planId, snapshotId, expectedSnapshotVersion: recorded.snapshot.snapshotVersion,
      mappings: [{
        sourceListId: 'ramen-list',
        target: { kind: 'new', collectionId, name: '서울 라멘' },
      }],
    })
    assert.equal(createdPlan.status, 'applied')
    assert.deepEqual(createdPlan.value.approval, {
      eligible: false, reason: 'unresolved-places',
    })
    const skipped = await transfers.applyImportPlanCommand(memberId, {
      schemaVersion: 'import-plan-command.v2', kind: 'decide-item',
      commandId: '01992d41-0000-7000-8000-000000000104',
      planId, expectedPlanRevision: createdPlan.value.planRevision,
      sourceListId: 'ramen-list', sourceItemId: 'saved-2', decision: { kind: 'skip' },
    })
    assert.equal(skipped.value.approval.eligible, true)
    const createReceipt = await database.pool.query(
      `SELECT result FROM transfers.command_receipts WHERE command_id = $1::uuid`,
      ['01992d41-0000-7000-8000-000000000103'],
    )
    assert.deepEqual(createReceipt.rows[0].result, {
      reference: {
        kind: 'import-plan', id: planId, acceptedRevision: createdPlan.value.planRevision,
      },
    })
    const replayedCreate = await transfers.applyImportPlanCommand(memberId, {
      schemaVersion: 'import-plan-command.v2', kind: 'create',
      commandId: '01992d41-0000-7000-8000-000000000103',
      planId, snapshotId, expectedSnapshotVersion: recorded.snapshot.snapshotVersion,
      mappings: [{
        sourceListId: 'ramen-list',
        target: { kind: 'new', collectionId, name: '서울 라멘' },
      }],
    })
    assert.equal(replayedCreate.status, 'replayed')
    assert.equal(replayedCreate.value.planRevision, skipped.value.planRevision)
    const approved = await transfers.applyImportPlanCommand(memberId, {
      schemaVersion: 'import-plan-command.v2', kind: 'approve',
      commandId: '01992d41-0000-7000-8000-000000000105',
      planId, expectedPlanRevision: skipped.value.planRevision,
    })
    assert.equal(approved.status, 'applied')
    assert.equal(approved.value.state, 'completed')
    assert.equal(approved.value.mappings[0].materialization.state, 'applied')
    assert.equal((await transfers.applyImportPlanCommand(memberId, {
      schemaVersion: 'import-plan-command.v2', kind: 'approve',
      commandId: '01992d41-0000-7000-8000-000000000105',
      planId, expectedPlanRevision: skipped.value.planRevision,
    })).status, 'replayed')

    const collection = await database.pool.query(
      `SELECT collection.visibility, collection.publication_id, placed.canonical_place_id
       FROM library.collections AS collection
       JOIN library.collection_places AS placed ON placed.collection_id = collection.id
       WHERE collection.id = $1::uuid`,
      [collectionId],
    )
    assert.deepEqual(collection.rows, [{
      visibility: 'private', publication_id: null, canonical_place_id: placeId,
    }])

    const outbound = await transfers.applyOutboundTransferCommand(memberId, {
      schemaVersion: 'outbound-transfer-command.v2', kind: 'preview',
      commandId: '01992d41-0000-7000-8000-000000000106',
      transferId, connectionId, collectionId,
      expectedCollectionRevision: approved.value.mappings[0].materialization.collectionRevision,
      selection: { kind: 'all' }, target: { kind: 'new-list', name: '네이버 라멘' },
    })
    assert.equal(outbound.value.state, 'blocked')
    assert.deepEqual(outbound.value.preview, {
      availability: 'unavailable', addCount: null, alreadyPresentCount: null,
      unresolvedCount: null, unsupportedCount: null,
      items: [{ placeId, status: 'unknown' }],
    })
    const unavailableApproval = await transfers.applyOutboundTransferCommand(memberId, {
      schemaVersion: 'outbound-transfer-command.v2', kind: 'approve',
      commandId: '01992d41-0000-7000-8000-000000000107',
      transferId, expectedTransferRevision: outbound.value.transferRevision,
    })
    assert.deepEqual(unavailableApproval.rejection, { code: 'target-unavailable' })

    let preflightCalls = 0
    let observationCalls = 0
    let providerUnavailable = false
    const replayTarget = {
      providerKey: 'naver',
      async observe() {
        observationCalls += 1
        if (providerUnavailable) throw new Error('provider unavailable')
        return { revision: 'naver-target-observation-1', lists: [] }
      },
      async preflight(input) {
        preflightCalls += 1
        if (providerUnavailable) throw new Error('provider unavailable')
        return {
          observationRevision: 'naver-target-observation-1',
          items: input.items.map((item) => ({ placeId: item.placeId, status: 'add' })),
        }
      },
    }
    const targetTransfers = new transfersModule.PostgresProviderTransfers({
      pool: database.pool,
      materializer: new library.PostgresImportedCollectionMaterializer(database.pool),
      collections: new library.PostgresCollectionTransferReader(database.pool),
      enabledConnectionAuthMethods: { naver: ['browser-session'] },
      targets: [replayTarget],
      now: () => new Date(at),
    })
    const previewCommand = {
      schemaVersion: 'outbound-transfer-command.v2', kind: 'preview',
      commandId: '01992d41-0000-7000-8000-000000000108',
      transferId: approvedTransferId, connectionId, collectionId,
      expectedCollectionRevision: approved.value.mappings[0].materialization.collectionRevision,
      selection: { kind: 'all' }, target: { kind: 'new-list', name: '승인된 내보내기' },
    }
    const previewed = await targetTransfers.applyOutboundTransferCommand(memberId, previewCommand)
    assert.equal(previewed.value.state, 'draft')
    const approveCommand = {
      schemaVersion: 'outbound-transfer-command.v2', kind: 'approve',
      commandId: '01992d41-0000-7000-8000-000000000109',
      transferId: approvedTransferId,
      expectedTransferRevision: previewed.value.transferRevision,
    }
    const approvedOutbound = await targetTransfers.applyOutboundTransferCommand(memberId, approveCommand)
    assert.equal(approvedOutbound.value.state, 'approved')
    providerUnavailable = true
    assert.equal(
      (await targetTransfers.applyOutboundTransferCommand(memberId, previewCommand)).status,
      'replayed',
    )
    assert.equal(
      (await targetTransfers.applyOutboundTransferCommand(memberId, approveCommand)).status,
      'replayed',
    )
    assert.equal(preflightCalls, 1)
    assert.equal(observationCalls, 1)

    await database.pool.query(
      'INSERT INTO places.canonical_places (id) VALUES ($1::uuid), ($2::uuid)',
      [secondPlaceId, thirdPlaceId],
    )
    const crashSnapshot = await transfers.recordSourceSnapshot({
      snapshotId: secondSnapshotId,
      ownerMemberId: memberId,
      connectionId,
      providerKey: 'naver',
      sourceRevision: 'naver-library-crash-recovery',
      observedAt: '2026-09-03T01:00:04.000Z',
      capturedAt: '2026-09-03T01:00:05.000Z',
      lists: [secondPlaceId, thirdPlaceId].map((canonicalPlaceId, sourcePosition) => ({
        sourceListId: `recovery-${sourcePosition}`,
        observedName: `복구 목록 ${sourcePosition}`,
        sourcePosition,
        items: [{
          sourceItemId: `recovery-item-${sourcePosition}`,
          providerPlaceId: `naver-recovery-${sourcePosition}`,
          observedName: `복구 장소 ${sourcePosition}`,
          observedAddress: null,
          observedCategory: null,
          observedLocation: null,
          match: { status: 'matched', placeId: canonicalPlaceId },
          sourcePosition: 0,
        }],
      })),
    })
    const recoveryPlan = await transfers.applyImportPlanCommand(memberId, {
      schemaVersion: 'import-plan-command.v2', kind: 'create',
      commandId: '01992d41-0000-7000-8000-000000000110',
      planId: secondPlanId,
      snapshotId: secondSnapshotId,
      expectedSnapshotVersion: crashSnapshot.snapshot.snapshotVersion,
      mappings: ['recovery-0', 'recovery-1'].map((sourceListId) => ({
        sourceListId,
        target: {
          kind: 'existing', collectionId,
          expectedCollectionRevision: approved.value.mappings[0].materialization.collectionRevision,
        },
      })),
    })
    const realMaterializer = new library.PostgresImportedCollectionMaterializer(database.pool)
    let materializationCalls = 0
    const crashTransfers = new transfersModule.PostgresProviderTransfers({
      pool: database.pool,
      materializer: {
        async materialize(input) {
          materializationCalls += 1
          if (materializationCalls === 2) throw new Error('simulated process interruption')
          return realMaterializer.materialize(input)
        },
      },
      collections: new library.PostgresCollectionTransferReader(database.pool),
      now: () => new Date(at),
    })
    const recoveryApproval = {
      schemaVersion: 'import-plan-command.v2', kind: 'approve',
      commandId: '01992d41-0000-7000-8000-000000000111',
      planId: secondPlanId,
      expectedPlanRevision: recoveryPlan.value.planRevision,
    }
    await assert.rejects(
      crashTransfers.applyImportPlanCommand(memberId, recoveryApproval),
      /simulated process interruption/,
    )
    const recovered = await transfers.applyImportPlanCommand(memberId, recoveryApproval)
    assert.equal(recovered.value.state, 'completed')
    assert.deepEqual(
      recovered.value.mappings.map((mapping) => mapping.materialization.state),
      ['applied', 'applied'],
    )
    assert.equal((await database.pool.query(
      'SELECT count(*)::int AS count FROM library.collection_places WHERE collection_id = $1::uuid',
      [collectionId],
    )).rows[0].count, 3)
  } finally {
    await database.close()
  }
})
