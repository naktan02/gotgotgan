import assert from 'node:assert/strict'
import test from 'node:test'
import { startReadyTransferOperationsFixture, transferOperationId as id, transferOperationIds } from './transfer-operations-postgres-fixture.mjs'

test('one-shot server facts survive persistence and materialization separately from aliases and unknown legacy facts', { timeout: 120_000 }, async () => {
  const fixture = await startReadyTransferOperationsFixture('gotgotgan-listed-facts-test')
  const { database, transfers, transfersModule, library, materializer } = fixture
  const { memberId, otherMemberId } = transferOperationIds
  const at = '2026-09-06T00:00:00.000Z'
  const facts = { schemaVersion: 'provider-listed-facts.v1', name: '원본에 명시된 라멘 가게',
    address: '서울 성동구 검증로 1', categoryLabel: '라멘', location: { latitude: 37.541, longitude: 127.05 } }
  try {
    const ingestion = await import('../../../dist/modules/ingestion/index.js')
    const places = await import('../../../dist/modules/places/index.js')
    const store = new ingestion.PostgresIngestionStore(database.pool)
    const canonicalStore = new places.PostgresCanonicalResolutionStore(database.pool)
    const canonical = {
      resolveProviderIdentity: (identity) => canonicalStore.resolveProviderIdentity(identity),
      apply: (attempt) => places.applyCanonicalResolution({ ...attempt, store: canonicalStore }),
    }
    await database.pool.query(`INSERT INTO transfers.import_sources
      (id, owner_membership_id, provider_key, source_kind, connection_id, acquisition_method, authorization_basis, created_at)
      VALUES ($1,$2,'naver','one-shot',NULL,'shared-link','link-possession',$3)`, [id(900), memberId, at])
    const capture = {
      snapshotId: id(901), ownerMemberId: memberId, providerKey: 'naver',
      source: { kind: 'one-shot', importSourceId: id(900), acquisitionMethod: 'shared-link',
        authorizationBasis: 'link-possession', accountAssurance: 'unverified' },
      sourceRevision: 'listed-facts-test.v1',
      provenance: { acquisitionKind: 'structured-web', parserVersion: 'server-parser-fixture.v1' },
      observedAt: at, capturedAt: at,
      lists: [{ sourceListId: 'private-list', observedName: '비공개 개인 목록', sourcePosition: 0,
        items: [0, 1].map((position) => ({
          sourceItemId: `item-${position}`, providerPlaceId: `listed-facts-test-${position}`,
          observedName: position === 0 ? '내 비밀 별칭' : '레거시 별칭', observedAddress: '개인 관측 주소',
          observedCategory: '개인 관측 분류', observedLocation: null, sourcePosition: position,
          match: { status: 'unresolved', reason: 'missing-identity' },
          ...(position === 0 ? { providerListedFacts: facts } : {}),
        })),
      }],
    }
    const captured = await transfers.recordSourceSnapshotV3(capture)
    assert.equal((await transfers.recordSourceSnapshotV3(capture)).status, 'replayed')
    assert.equal(captured.snapshot.source.accountAssurance, 'unverified')
    assert.equal(JSON.stringify(captured.snapshot).includes('providerListedFacts'), false)
    const invalidFacts = [
      ['JSON null', null],
      ['null schema version', { ...facts, schemaVersion: null }],
      ['unexpected fact field', { ...facts, privateMemo: '허용되지 않는 개인 메모' }],
      ['unexpected location field', { ...facts, location: { ...facts.location, accuracy: 10 } }],
      ['latitude outside WGS84', { ...facts, location: { ...facts.location, latitude: 90.1 } }],
      ['longitude outside WGS84', { ...facts, location: { ...facts.location, longitude: -180.1 } }],
      ['null coordinate', { ...facts, location: { ...facts.location, latitude: null } }],
    ]
    for (const [label, value] of invalidFacts) {
      await assert.rejects(database.administratorClient.query(`UPDATE transfers.source_snapshot_items
        SET provider_listed_facts=$2::jsonb WHERE snapshot_id=$1 AND source_item_id='item-0'`,
      [id(901), JSON.stringify(value)]),
      { code: '23514', constraint: 'provider_listed_facts_v1_shape' }, label)
    }
    assert.deepEqual((await database.pool.query(`SELECT observed_name, provider_listed_facts
      FROM transfers.source_snapshot_items WHERE snapshot_id=$1 ORDER BY source_position`, [id(901)])).rows, [
      { observed_name: '내 비밀 별칭', provider_listed_facts: facts },
      { observed_name: '레거시 별칭', provider_listed_facts: null },
    ])
    const changed = structuredClone(capture)
    changed.lists[0].items[0].providerListedFacts.name = '재실행으로 바꾼 이름'
    await assert.rejects(transfers.recordSourceSnapshotV3(changed), /identity reused/)
    assert.equal(await transfers.getSnapshotV3(otherMemberId, id(901)), undefined)
    const created = await transfers.applyImportPlanCommandV4(memberId, {
      schemaVersion: 'import-plan-command.v4', commandId: id(902), kind: 'create', planId: id(903),
      snapshotId: id(901), expectedSnapshotVersion: captured.snapshot.snapshotVersion,
      mappings: [{ sourceListId: 'private-list', target: { kind: 'new', collectionId: id(904), name: '나의 목록' } }],
    })
    assert.deepEqual(created.value.approval, { eligible: true, reason: null })
    const approved = await transfers.applyImportPlanCommandV4(memberId, {
      schemaVersion: 'import-plan-command.v4', commandId: id(905), kind: 'approve', planId: id(903),
      expectedPlanRevision: created.value.planRevision,
    })
    assert.equal(approved.status, 'applied')
    const observedEvidence = new Map()
    const worker = new transfersModule.PostgresImportMaterializationWorker(database.pool,
      { materialize: (input) => materializer.materialize(library.normalizeImportedCollectionMaterialization(input)) },
      { async materialize(input) {
        observedEvidence.set(input.providerPlaceId, input.snapshotEvidence)
        const result = await ingestion.materializeSnapshotProviderPlace({
          evidence: { ...input, externalPlaceId: input.providerPlaceId,
            policyReference: 'transfer-source-snapshot-policy-create.v1', rationale: 'approved-import:minimum-source-snapshot' },
          snapshot: input.snapshotEvidence, ingestionStore: store, canonical,
        })
        return { placeId: result.canonicalPlaceId }
      } },
      { workerId: 'listed-facts-worker', now: () => new Date(at), leaseMilliseconds: 30_000, maximumBackoffMilliseconds: 60_000 },
    )
    assert.equal(await worker.runOnce(), 'completed')
    assert.equal(await worker.runOnce(), 'idle')
    assert.equal(observedEvidence.get('listed-facts-test-0').name, '내 비밀 별칭')
    assert.deepEqual(observedEvidence.get('listed-facts-test-0').providerListedFacts, facts)
    assert.equal(observedEvidence.get('listed-facts-test-1').providerListedFacts, undefined)
    const observations = (await database.pool.query(`SELECT external_place_id, facts FROM ingestion.source_observations
      WHERE external_place_id LIKE 'listed-facts-test-%' ORDER BY external_place_id`)).rows
    assert.equal(observations.length, 2)
    assert.deepEqual(observations[0].facts.providerListedFacts, facts)
    assert.equal(observations[0].facts.name, '내 비밀 별칭')
    assert.equal(observations[1].facts.providerListedFacts, undefined)
    assert.ok(!JSON.stringify(observations).includes('비공개 개인 목록'))
    assert.deepEqual((await database.pool.query(`SELECT
      (SELECT count(*)::int FROM places.canonical_place_profile_revisions) AS profiles,
      (SELECT count(*)::int FROM search.place_documents) AS public_documents,
      (SELECT count(*)::int FROM library.collection_places WHERE collection_id=$1) AS private_places`, [id(904)])).rows,
    [{ profiles: 0, public_documents: 0, private_places: 2 }])
    assert.deepEqual((await database.pool.query(`SELECT connection_id, import_source_kind
      FROM transfers.operations WHERE resource_id=$1`, [id(903)])).rows, [{ connection_id: null, import_source_kind: 'one-shot' }])
  } finally { await fixture.close() }
})
