import assert from 'node:assert/strict'
import test from 'node:test'

import {
  startReadyTransferOperationsFixture,
  transferOperationId as id,
  transferOperationIds,
} from './transfer-operations-postgres-fixture.mjs'

test('one-shot multi-list snapshot reaches private Collections without a connection identity', {
  timeout: 120_000,
}, async () => {
  const fixture = await startReadyTransferOperationsFixture('gotgotgan-one-shot-import')
  const { database, transfers, transfersModule, library, materializer } = fixture
  const { memberId } = transferOperationIds
  const at = '2026-09-05T03:00:00.000Z'
  const importSourceId = id(800)
  const snapshotId = id(801)
  const planId = id(802)
  const collectionIds = [id(803), id(804)]
  const placeIds = new Map([
    ['naver-shared-place-a', id(805)],
    ['naver-shared-place-b', id(806)],
  ])
  try {
    await database.pool.query(
      `INSERT INTO transfers.import_sources (
         id, owner_membership_id, provider_key, source_kind,
         connection_id, acquisition_method, authorization_basis, created_at
       ) VALUES ($1::uuid,$2::uuid,'naver','one-shot',NULL,
         'shared-link','link-possession',$3::timestamptz)`,
      [importSourceId, memberId, at],
    )
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
      sourceRevision: 'two-shared-links-v1',
      provenance: { acquisitionKind: 'structured-web', parserVersion: 'naver-shared-list.v1' },
      observedAt: at,
      capturedAt: at,
      lists: [...placeIds].map(([providerPlaceId], sourcePosition) => ({
        sourceListId: `shared-list-${sourcePosition + 1}`,
        observedName: `공유 목록 ${sourcePosition + 1}`,
        sourcePosition,
        items: [{
          sourceItemId: `shared-item-${sourcePosition + 1}`,
          providerPlaceId,
          observedName: `공유 장소 ${sourcePosition + 1}`,
          observedAddress: null,
          observedCategory: null,
          observedLocation: null,
          match: { status: 'unresolved', reason: 'missing-identity' },
          sourcePosition: 0,
        }, ...(sourcePosition === 1 ? [{
          sourceItemId: 'shared-item-without-provider-id',
          providerPlaceId: null,
          observedName: '식별자가 없는 공유 장소',
          observedAddress: null,
          observedCategory: null,
          observedLocation: null,
          match: { status: 'unresolved', reason: 'missing-identity' },
          sourcePosition: 1,
        }] : [])],
      })),
    })

    const created = await transfers.applyImportPlanCommandV4(memberId, {
      schemaVersion: 'import-plan-command.v4',
      commandId: id(807),
      kind: 'create',
      planId,
      snapshotId,
      expectedSnapshotVersion: captured.snapshot.snapshotVersion,
      mappings: captured.snapshot.lists.map((list, index) => ({
        sourceListId: list.sourceListId,
        target: {
          kind: 'new',
          collectionId: collectionIds[index],
          name: list.observedName,
        },
      })),
    })
    assert.equal(created.status, 'applied')
    assert.equal(created.value.schemaVersion, 'import-plan.v4')
    assert.deepEqual(created.value.source, captured.snapshot.source)
    assert.deepEqual(created.value.mappings.flatMap((mapping) => (
      mapping.preview.items.map((item) => item.decision)
    )), ['policy-create', 'policy-create', 'none'])
    assert.deepEqual(created.value.approval, {
      eligible: false, reason: 'unresolved-places',
    })
    assert.equal(await transfers.getImportPlanV3(memberId, planId), undefined)

    const refreshed = await transfers.applyImportPlanCommandV4(memberId, {
      schemaVersion: 'import-plan-command.v4',
      commandId: id(808),
      kind: 'refresh-evidence',
      planId,
      expectedPlanRevision: created.value.planRevision,
    })
    assert.equal(refreshed.status, 'applied')
    assert.equal(refreshed.value.planRevision, created.value.planRevision)
    const decided = await transfers.applyImportPlanCommandV4(memberId, {
      schemaVersion: 'import-plan-command.v4',
      commandId: id(809),
      kind: 'decide-item',
      planId,
      expectedPlanRevision: refreshed.value.planRevision,
      sourceListId: 'shared-list-2',
      sourceItemId: 'shared-item-without-provider-id',
      decision: { kind: 'skip' },
    })
    assert.equal(decided.status, 'applied')
    assert.deepEqual(decided.value.approval, { eligible: true, reason: null })

    const approved = await transfers.applyImportPlanCommandV4(memberId, {
      schemaVersion: 'import-plan-command.v4',
      commandId: id(810),
      kind: 'approve',
      planId,
      expectedPlanRevision: decided.value.planRevision,
    })
    assert.equal(approved.status, 'applied')
    assert.equal(approved.value.state, 'applying')
    assert.deepEqual((await database.pool.query(
      `SELECT connection_id, account_label, import_source_id, import_source_kind
       FROM transfers.operations
       WHERE resource_kind = 'import-plan' AND resource_id = $1::uuid`,
      [planId],
    )).rows, [{
      connection_id: null,
      account_label: null,
      import_source_id: importSourceId,
      import_source_kind: 'one-shot',
    }])

    const worker = new transfersModule.PostgresImportMaterializationWorker(
      database.pool,
      { materialize: (input) => materializer.materialize(
        library.normalizeImportedCollectionMaterialization(input),
      ) },
      { async materialize(input) {
        const placeId = placeIds.get(input.providerPlaceId)
        assert.ok(placeId)
        assert.ok(input.snapshotEvidence)
        await database.pool.query(
          'INSERT INTO places.canonical_places (id) VALUES ($1::uuid) ON CONFLICT DO NOTHING',
          [placeId],
        )
        return { placeId }
      } },
      {
        workerId: 'one-shot-import-worker',
        now: () => new Date(at),
        leaseMilliseconds: 30_000,
        maximumBackoffMilliseconds: 60_000,
      },
    )
    assert.equal(await worker.runOnce(), 'completed')
    assert.equal(await worker.runOnce(), 'idle')
    const completed = await transfers.getImportPlanV4(memberId, planId)
    assert.equal(completed.state, 'completed')
    assert.ok(completed.mappings.every((mapping) => mapping.materialization.state === 'applied'))

    assert.deepEqual((await database.pool.query(
      `SELECT id, name, visibility
       FROM library.collections
       WHERE id = ANY($1::uuid[])
       ORDER BY id`,
      [collectionIds],
    )).rows, [
      { id: collectionIds[0], name: '공유 목록 1', visibility: 'private' },
      { id: collectionIds[1], name: '공유 목록 2', visibility: 'private' },
    ])
    assert.deepEqual((await database.pool.query(
      `SELECT DISTINCT import_source_id, import_source_kind, source_connection_reference
       FROM library.collection_place_import_provenance
       WHERE import_source_id = $1::uuid`,
      [importSourceId],
    )).rows, [{
      import_source_id: importSourceId,
      import_source_kind: 'one-shot',
      source_connection_reference: null,
    }])
    assert.equal((await database.pool.query(
      `SELECT count(*)::int AS count
       FROM library.import_source_list_bindings
       WHERE import_source_id = $1::uuid AND import_source_kind = 'one-shot'
         AND source_connection_reference IS NULL`,
      [importSourceId],
    )).rows[0].count, 2)

    const otherImportSourceId = id(811)
    await database.pool.query(
      `INSERT INTO transfers.import_sources (
         id, owner_membership_id, provider_key, source_kind,
         connection_id, acquisition_method, authorization_basis, created_at
       ) VALUES ($1::uuid,$2::uuid,'naver','one-shot',NULL,
         'shared-link','link-possession',$3::timestamptz)`,
      [otherImportSourceId, memberId, at],
    )
    await assert.rejects(
      database.administratorClient.query(
        `UPDATE transfers.operations
         SET import_source_id = $2::uuid
         WHERE resource_kind = 'import-plan' AND resource_id = $1::uuid`,
        [planId, otherImportSourceId],
      ),
      (error) => error.code === 'P0001' &&
        error.message === 'import operation resource binding is invalid',
    )
  } finally {
    await fixture.close()
  }
})
