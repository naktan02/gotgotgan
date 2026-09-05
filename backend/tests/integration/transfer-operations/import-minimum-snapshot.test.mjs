import assert from 'node:assert/strict'
import test from 'node:test'

import {
  startReadyTransferOperationsFixture,
  transferOperationId as id,
  transferOperationIds,
} from './transfer-operations-postgres-fixture.mjs'

test('minimum bookmark import completes without detail, dedupes identity and preserves pinned evidence', {
  timeout: 120_000,
}, async () => {
  const fixture = await startReadyTransferOperationsFixture('gotgotgan-minimum-import')
  const { database, transfers, transfersModule, library, materializer } = fixture
  const { memberId, connectionId } = transferOperationIds
  const ingestion = await import('../../../dist/modules/ingestion/index.js')
  const places = await import('../../../dist/modules/places/index.js')
  const ingestionStore = new ingestion.PostgresIngestionStore(database.pool)
  const canonicalStore = new places.PostgresCanonicalResolutionStore(database.pool)
  const canonical = {
    resolveProviderIdentity: (identity) => canonicalStore.resolveProviderIdentity(identity),
    apply: (attempt) => places.applyCanonicalResolution({ ...attempt, store: canonicalStore }),
  }
  const at = '2026-09-03T02:02:00.000Z'
  try {
    const captured = await transfers.recordSourceSnapshot({
      snapshotId: id(700), ownerMemberId: memberId, connectionId, providerKey: 'naver',
      sourceRevision: 'minimum-v1',
      provenance: { acquisitionKind: 'browser-network', parserVersion: 'saved-place.v1' },
      observedAt: '2026-09-03T02:01:00.000Z', capturedAt: '2026-09-03T02:01:01.000Z',
      lists: [{
        sourceListId: 'saved-list', observedName: '개인 목록 이름', sourcePosition: 0,
        items: [...[0, 1].map((position) => ({
          sourceItemId: `item-${position}`, providerPlaceId: 'minimum-theme-park',
          observedName: '놀이공원', observedAddress: null, observedCategory: '테마파크',
          observedLocation: null, sourcePosition: position,
          match: { status: 'unresolved', reason: 'missing-identity' },
        })), {
          sourceItemId: 'located-item', providerPlaceId: 'minimum-located-cafe',
          observedName: '내가 정한 카페 별명', observedAddress: null, observedCategory: '카페',
          observedLocation: { latitude: 37.5, longitude: 127.1 }, sourcePosition: 2,
          match: { status: 'unresolved', reason: 'missing-identity' },
        }],
      }],
    })
    const created = await transfers.applyImportPlanCommandV3(memberId, {
      schemaVersion: 'import-plan-command.v3', commandId: id(701), kind: 'create',
      planId: id(702), snapshotId: id(700),
      expectedSnapshotVersion: captured.snapshot.snapshotVersion,
      mappings: [{ sourceListId: 'saved-list', target: {
        kind: 'new', collectionId: id(703), name: '내 놀이공원',
      } }],
    })
    assert.equal(created.status, 'applied')
    assert.deepEqual(created.value.approval, { eligible: true, reason: null })
    assert.deepEqual(created.value.mappings[0].preview.items.map((item) => ({
      decision: item.decision, detail: item.providerDetailStatus,
    })), [
      { decision: 'policy-create', detail: 'pending' },
      { decision: 'policy-create', detail: 'pending' },
      { decision: 'policy-create', detail: 'pending' },
    ])
    assert.equal((await database.pool.query(
      `SELECT count(*)::int AS count FROM ingestion.provider_place_detail_observations`,
    )).rows[0].count, 0)
    // Snapshot evidence must be this plan's exact immutable source item.
    await assert.rejects(database.pool.query(
      `UPDATE transfers.import_plan_items SET evidence_snapshot_id = $2::uuid
       WHERE plan_id = $1::uuid`, [id(702), id(799)],
    ), /foreign key constraint/)

    const command = {
      schemaVersion: 'import-plan-command.v3', kind: 'approve', commandId: id(704),
      planId: id(702), expectedPlanRevision: created.value.planRevision,
    }
    const approved = await transfers.applyImportPlanCommandV3(memberId, command)
    assert.equal(approved.status, 'applied')
    await assert.rejects(database.pool.query(
      `UPDATE transfers.import_plan_items SET evidence_snapshot_id = NULL
       WHERE plan_id = $1::uuid`, [id(702)],
    ), /approved import plan items are immutable/)
    const worker = new transfersModule.PostgresImportMaterializationWorker(
      database.pool,
      { materialize: (input) => materializer.materialize(
        library.normalizeImportedCollectionMaterialization(input),
      ) },
      { async materialize(input) {
        assert.ok(input.snapshotEvidence)
        const result = await ingestion.materializeSnapshotProviderPlace({
          evidence: {
            ...input, externalPlaceId: input.providerPlaceId,
            policyReference: 'transfer-source-snapshot-policy-create.v1',
            rationale: 'approved-import:minimum-source-snapshot',
          },
          snapshot: input.snapshotEvidence, ingestionStore, canonical,
        })
        return { placeId: result.canonicalPlaceId }
      } },
      { workerId: 'minimum-import-worker', now: () => new Date(at),
        leaseMilliseconds: 30_000, maximumBackoffMilliseconds: 60_000 },
    )
    assert.equal(await worker.runOnce(), 'completed')
    assert.equal(await worker.runOnce(), 'idle')
    assert.equal((await transfers.applyImportPlanCommandV3(memberId, command)).status, 'replayed')
    assert.equal((await transfers.getImportPlanV3(memberId, id(702))).state, 'completed')
    assert.equal((await database.pool.query(
      `SELECT count(*)::int AS count FROM library.collection_places WHERE collection_id = $1::uuid`,
      [id(703)],
    )).rows[0].count, 2)
    assert.deepEqual((await database.pool.query(
      `SELECT
         (SELECT count(*)::int FROM places.canonical_place_profile_revisions) AS profiles,
         (SELECT count(*)::int FROM search.place_documents) AS public_documents`,
    )).rows, [{ profiles: 0, public_documents: 0 }])
    const evidence = (await database.pool.query(
      `SELECT observation_kind, facts FROM ingestion.source_observations
       WHERE external_place_id = 'minimum-theme-park'`,
    )).rows
    assert.equal(evidence.length, 2)
    assert.ok(evidence.every((row) => row.observation_kind === 'general'))
    assert.ok(evidence.every((row) => !JSON.stringify(row.facts).includes('개인 목록 이름')))
    const memberPlaces = new transfersModule.PostgresMemberImportedPlaces(database.pool)
    const readPrivate = async (owner, placeIds) => (await memberPlaces.read(owner, placeIds)).map((row) => ({
      placeId: row.placeId, name: row.observedName, areaLabel: null, location: row.observedLocation,
      primaryTaxonomy: null, taxonomyKeys: [],
      evidence: { status: 'unverified', projectedAt: row.capturedAt },
    }))
    const workspace = new library.PostgresPersonalLibraryWorkspace(database.pool, async () => [], readPrivate)
    const query = {
      memberId, favoriteScope: { kind: 'collection', collectionId: id(703) },
      ratingFilter: { kind: 'any' }, tagIds: [], tagMatch: 'all', areaKeys: [], taxonomyKeys: [], limit: 50,
    }
    const own = await workspace.open(query)
    assert.equal(own.favoritePlaces.items.length, 2)
    const located = own.favoritePlaces.items.find((row) => row.place?.name === '내가 정한 카페 별명')
    assert.deepEqual(located.place.location, { latitude: 37.5, longitude: 127.1 })
    assert.equal(located.place.evidence.status, 'unverified')
    assert.equal(own.favoritePlaces.items.find((row) => row.place?.name === '놀이공원').place.location, null)
    const placeIds = own.favoritePlaces.items.map((row) => row.placeId)
    assert.deepEqual(await memberPlaces.read(transferOperationIds.otherMemberId, placeIds), [])
    await database.pool.query(
      `INSERT INTO library.collections (id, owner_membership_id, name, visibility, created_at, updated_at)
       VALUES ($1::uuid,$2::uuid,'다른 회원 목록','private',$3::timestamptz,$3::timestamptz)`,
      [id(706), transferOperationIds.otherMemberId, at],
    )
    await database.pool.query(
      `INSERT INTO library.collection_places (collection_id, canonical_place_id, position, added_at)
       VALUES ($1::uuid,$2::uuid,0,$3::timestamptz)`, [id(706), located.placeId, at],
    )
    const other = await workspace.open({ ...query, memberId: transferOperationIds.otherMemberId,
      favoriteScope: { kind: 'collection', collectionId: id(706) } })
    assert.equal(other.favoritePlaces.items[0].place, null)
    const publicSummary = { ...located.place, name: '공개 카탈로그 이름', evidence: {
      status: 'verified', projectedAt: at,
    } }
    const publicPreferred = new library.PostgresPersonalLibraryWorkspace(
      database.pool, async () => [publicSummary], readPrivate,
    )
    assert.equal((await publicPreferred.open(query)).favoritePlaces.items.find(
      (row) => row.placeId === located.placeId,
    ).place.name, '공개 카탈로그 이름')
    await database.pool.query(
      `UPDATE library.collections SET visibility = 'public', publication_id = $2::uuid
       WHERE id = $1::uuid`, [id(703), id(705)],
    )
    const publicQueries = new library.PostgresLibraryQueries(
      database.pool, async () => [], async () => ({ places: [], unprojectedPlaceCount: 0 }),
    )
    const published = await publicQueries.getPublishedCollection({ publicationId: id(705), limit: 50 })
    assert.ok(published.places.every((row) => row.place === null))
    assert.deepEqual((await database.pool.query(
      `SELECT status FROM ingestion.provider_place_detail_statuses
       WHERE provider_key = 'naver' AND provider_place_id = 'minimum-theme-park'`,
    )).rows, [{ status: 'pending' }])
    await database.pool.query(
      `UPDATE ingestion.provider_place_detail_statuses SET status = 'unavailable',
         updated_at = $1::timestamptz
       WHERE provider_key = 'naver' AND provider_place_id = 'minimum-theme-park'`, [at],
    )
    const afterFailure = await transfers.getImportPlanV3(memberId, id(702))
    assert.equal(afterFailure.state, 'completed')
    assert.equal(afterFailure.mappings[0].preview.items[0].providerDetailStatus, 'unavailable')
  } finally {
    await fixture.close()
  }
})
