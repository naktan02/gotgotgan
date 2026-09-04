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
const manualSnapshotId = '01992d41-0000-7000-8000-000000000014'
const manualPlanId = '01992d41-0000-7000-8000-000000000015'
const manualCollectionId = '01992d41-0000-7000-8000-000000000016'
const detailObservationId = '01992d41-0000-7000-8000-000000000017'
const detailCandidateId = '01992d41-0000-7000-8000-000000000018'
const v2PlanId = '01992d41-0000-7000-8000-000000000019'
const v2CollectionId = '01992d41-0000-7000-8000-000000000020'
const refreshedDetailObservationId = '01992d41-0000-7000-8000-000000000021'
const refreshedDetailCandidateId = '01992d41-0000-7000-8000-000000000022'
const cancelledPlanId = '01992d41-0000-7000-8000-000000000023'
const accountFingerprint = 'a'.repeat(64)
const at = '2026-09-03T01:00:00.000Z'

test('provider transfers require immutable snapshots and explicit approval', { timeout: 120_000 }, async () => {
  const database = await startPreparedPlaceDatabase('gotgotgan-provider-transfers')
  try {
    const library = await import('../../dist/modules/library/index.js')
    const ingestion = await import('../../dist/modules/ingestion/index.js')
    const places = await import('../../dist/modules/places/index.js')
    const transfersModule = await import('../../dist/modules/transfers/index.js')
    const ingestionStore = new ingestion.PostgresIngestionStore(database.pool)
    assert.equal((await database.pool.query(
      `SELECT pg_get_expr(defaults.adbin, defaults.adrelid) AS default_value
       FROM pg_attribute AS attribute
       JOIN pg_attrdef AS defaults
         ON defaults.adrelid = attribute.attrelid AND defaults.adnum = attribute.attnum
       WHERE attribute.attrelid = 'transfers.import_plans'::regclass
         AND attribute.attname = 'contract_major'`,
    )).rows[0].default_value, '2')
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
      accountFingerprint,
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
      provenance: { acquisitionKind: 'browser-network', parserVersion: 'test-naver.v1' },
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
        }, {
          sourceItemId: 'saved-3', providerPlaceId: 'naver-place-new',
          observedName: '새 쇼유라멘집', observedAddress: '서울시 종로구',
          observedCategory: '쇼유라멘',
          observedLocation: { latitude: 37.57, longitude: 126.98 },
          match: { status: 'unresolved', reason: 'missing-identity' }, sourcePosition: 2,
        }],
      }],
    })
    assert.equal(recorded.status, 'applied')
    assert.deepEqual((await database.pool.query(
      `SELECT acquisition_kind, parser_version
       FROM transfers.source_snapshots WHERE id = $1::uuid`,
      [snapshotId],
    )).rows[0], {
      acquisition_kind: 'browser-network', parser_version: 'test-naver.v1',
    })
    assert.equal((await transfers.recordSourceSnapshot({
      snapshotId,
      ownerMemberId: memberId,
      connectionId,
      providerKey: 'naver',
      sourceRevision: 'naver-library-42',
      provenance: { acquisitionKind: 'browser-network', parserVersion: 'test-naver.v1' },
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
        provenance: { acquisitionKind: 'browser-network', parserVersion: 'test-naver.v1' },
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

    await ingestion.recordSourceObservation({
      id: detailObservationId,
      providerKey: 'naver', externalPlaceId: 'naver-place-new',
      acquisitionKind: 'documented-api', payloadChecksum: 'b'.repeat(64),
      parserVersion: 'naver-place-detail.v1',
      observedAt: '2026-09-03T01:00:03.000Z',
      acquiredAt: '2026-09-03T01:00:04.000Z',
      captureReference: 'provider-detail:naver-place-new',
      observationKind: 'provider-detail',
      facts: {
        name: '검증된 쇼유라멘집', address: '서울시 종로구',
        categoryLabel: '쇼유라멘', location: { latitude: 37.57, longitude: 126.98 },
      },
      confidence: 1,
      store: ingestionStore,
    })
    await ingestion.recordPlaceCandidate({
      id: detailCandidateId, sourceObservationId: detailObservationId,
      parserVersion: 'naver-place-detail.v1', name: '검증된 쇼유라멘집',
      address: '서울시 종로구', location: { latitude: 37.57, longitude: 126.98 },
      attributes: { categoryLabel: '쇼유라멘' },
      createdAt: '2026-09-03T01:00:04.000Z', store: ingestionStore,
    })
    await database.pool.query(
      `INSERT INTO ingestion.provider_place_detail_observations (
         provider_key, provider_place_id, source_observation_id,
         place_candidate_id, normalized_at
       ) VALUES ('naver','naver-place-new',$1::uuid,$2::uuid,$3::timestamptz)`,
      [detailObservationId, detailCandidateId, '2026-09-03T01:00:04.000Z'],
    )
    await database.pool.query(
      `UPDATE ingestion.provider_place_detail_statuses
       SET status = 'available', last_detail_observation_id = $1::uuid,
           updated_at = $2::timestamptz
       WHERE provider_key = 'naver' AND provider_place_id = 'naver-place-new'`,
      [detailObservationId, '2026-09-03T01:00:04.000Z'],
    )

    const v2Plan = await transfers.applyImportPlanCommandV2(memberId, {
      schemaVersion: 'import-plan-command.v2', kind: 'create',
      commandId: '01992d41-0000-7000-8000-000000000118',
      planId: v2PlanId, snapshotId,
      expectedSnapshotVersion: recorded.snapshot.snapshotVersion,
      mappings: [{
        sourceListId: 'ramen-list',
        target: { kind: 'new', collectionId: v2CollectionId, name: 'V2 서울 라멘' },
      }],
    })
    assert.equal(v2Plan.value.schemaVersion, 'import-plan.v2')
    assert.deepEqual(v2Plan.value.mappings[0].preview.items.map((item) => ({
      sourceItemId: item.sourceItemId, status: item.status, decision: item.decision,
    })), [{
      sourceItemId: 'saved-1', status: 'add', decision: 'snapshot-match',
    }, {
      sourceItemId: 'saved-2', status: 'unresolved', decision: 'none',
    }, {
      sourceItemId: 'saved-3', status: 'unresolved', decision: 'none',
    }])
    assert.equal(await transfers.getImportPlanV3(memberId, v2PlanId), undefined)
    const v3AgainstV2 = await transfers.applyImportPlanCommandV3(memberId, {
      schemaVersion: 'import-plan-command.v3', kind: 'approve',
      commandId: '01992d41-0000-7000-8000-000000000119',
      planId: v2PlanId, expectedPlanRevision: v2Plan.value.planRevision,
    })
    assert.deepEqual(v3AgainstV2.rejection, { code: 'not-found' })

    const createdPlan = await transfers.applyImportPlanCommandV3(memberId, {
      schemaVersion: 'import-plan-command.v3', kind: 'create',
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
    assert.deepEqual(createdPlan.value.mappings[0].preview.items.map((item) => ({
      sourceItemId: item.sourceItemId, status: item.status,
      decision: item.decision, placeId: item.placeId,
    })), [{
      sourceItemId: 'saved-1', status: 'add', decision: 'snapshot-match', placeId,
    }, {
      sourceItemId: 'saved-2', status: 'unresolved', decision: 'none', placeId: null,
    }, {
      sourceItemId: 'saved-3', status: 'add', decision: 'policy-create', placeId: null,
    }])
    assert.deepEqual((await database.pool.query(
      `SELECT evidence_source_observation_id, evidence_place_candidate_id
       FROM transfers.import_plan_items
       WHERE plan_id = $1::uuid AND source_item_id = 'saved-3'`,
      [planId],
    )).rows, [{
      evidence_source_observation_id: detailObservationId,
      evidence_place_candidate_id: detailCandidateId,
    }])
    await ingestion.recordSourceObservation({
      id: refreshedDetailObservationId,
      providerKey: 'naver', externalPlaceId: 'naver-place-new',
      acquisitionKind: 'documented-api', payloadChecksum: 'c'.repeat(64),
      parserVersion: 'naver-place-detail.v2',
      observedAt: '2026-09-03T01:00:08.000Z',
      acquiredAt: '2026-09-03T01:00:09.000Z',
      captureReference: 'provider-detail:naver-place-new:refresh',
      observationKind: 'provider-detail',
      facts: {
        name: '갱신된 쇼유라멘집', address: '서울시 종로구',
        categoryLabel: '쇼유라멘', location: { latitude: 37.57, longitude: 126.98 },
      },
      confidence: 1,
      store: ingestionStore,
    })
    await ingestion.recordPlaceCandidate({
      id: refreshedDetailCandidateId, sourceObservationId: refreshedDetailObservationId,
      parserVersion: 'naver-place-detail.v2', name: '갱신된 쇼유라멘집',
      address: '서울시 종로구', location: { latitude: 37.57, longitude: 126.98 },
      attributes: { categoryLabel: '쇼유라멘' },
      createdAt: '2026-09-03T01:00:09.000Z', store: ingestionStore,
    })
    await database.pool.query(
      `INSERT INTO ingestion.provider_place_detail_observations (
         provider_key, provider_place_id, source_observation_id, place_candidate_id,
         normalized_at, previous_source_observation_id, change_kind
       ) VALUES ('naver','naver-place-new',$1::uuid,$2::uuid,$3::timestamptz,$4::uuid,'changed')`,
      [refreshedDetailObservationId, refreshedDetailCandidateId,
        '2026-09-03T01:00:09.000Z', detailObservationId],
    )
    await assert.rejects(
      database.pool.query(
        `UPDATE transfers.import_plan_items
         SET evidence_place_candidate_id = $2::uuid
         WHERE plan_id = $1::uuid AND source_item_id = 'saved-3'`,
        [planId, refreshedDetailCandidateId],
      ),
      /foreign key/i,
    )
    assert.equal(await transfers.getImportPlanV2(memberId, planId), undefined)
    const v2AgainstV3 = await transfers.applyImportPlanCommandV2(memberId, {
      schemaVersion: 'import-plan-command.v2', kind: 'approve',
      commandId: '01992d41-0000-7000-8000-000000000120',
      planId, expectedPlanRevision: createdPlan.value.planRevision,
    })
    assert.deepEqual(v2AgainstV3.rejection, { code: 'not-found' })
    assert.deepEqual((await database.pool.query(
      `SELECT id, contract_major FROM transfers.import_plans
       WHERE id IN ($1::uuid, $2::uuid) ORDER BY contract_major`,
      [v2PlanId, planId],
    )).rows, [{ id: v2PlanId, contract_major: 2 }, { id: planId, contract_major: 3 }])

    const skipped = await transfers.applyImportPlanCommandV3(memberId, {
      schemaVersion: 'import-plan-command.v3', kind: 'decide-item',
      commandId: '01992d41-0000-7000-8000-000000000104',
      planId, expectedPlanRevision: createdPlan.value.planRevision,
      sourceListId: 'ramen-list', sourceItemId: 'saved-2', decision: { kind: 'skip' },
    })
    assert.equal(skipped.value.approval.eligible, true)
    const createReceipt = await database.pool.query(
      `SELECT command_kind, result FROM transfers.command_receipts WHERE command_id = $1::uuid`,
      ['01992d41-0000-7000-8000-000000000103'],
    )
    assert.deepEqual(createReceipt.rows[0], {
      command_kind: 'import-plan-v3-create',
      result: {
        reference: {
          kind: 'import-plan', id: planId, acceptedRevision: createdPlan.value.planRevision,
        },
      },
    })
    const replayedCreate = await transfers.applyImportPlanCommandV3(memberId, {
      schemaVersion: 'import-plan-command.v3', kind: 'create',
      commandId: '01992d41-0000-7000-8000-000000000103',
      planId, snapshotId, expectedSnapshotVersion: recorded.snapshot.snapshotVersion,
      mappings: [{
        sourceListId: 'ramen-list',
        target: { kind: 'new', collectionId, name: '서울 라멘' },
      }],
    })
    assert.equal(replayedCreate.status, 'replayed')
    assert.equal(replayedCreate.value.planRevision, skipped.value.planRevision)
    const approved = await transfers.applyImportPlanCommandV3(memberId, {
      schemaVersion: 'import-plan-command.v3', kind: 'approve',
      commandId: '01992d41-0000-7000-8000-000000000105',
      planId, expectedPlanRevision: skipped.value.planRevision,
    })
    assert.equal(approved.status, 'applied')
    assert.equal(approved.value.state, 'applying')
    assert.equal(approved.value.mappings[0].materialization.state, 'pending')

    const canonicalStore = new places.PostgresCanonicalResolutionStore(database.pool)
    const canonical = {
      resolveProviderIdentity: (identity) => canonicalStore.resolveProviderIdentity(identity),
      apply: (attempt) => places.applyCanonicalResolution({ ...attempt, store: canonicalStore }),
    }
    const sourcePlaceMaterializer = {
      async materialize(input) {
        const result = await ingestion.materializeVerifiedProviderPlace({
          evidence: {
            decisionId: input.decisionId, proposedPlaceId: input.proposedPlaceId,
            providerKey: input.providerKey, externalPlaceId: input.providerPlaceId,
            sourceObservationId: input.sourceObservationId,
            placeCandidateId: input.placeCandidateId,
            occurredAt: input.occurredAt,
            policyReference: 'transfer-verified-provider-detail-policy-create.v1',
            rationale: 'approved-import:server-verified-provider-detail',
          },
          ingestionStore,
          canonical,
        })
        const resolved = await canonicalStore.resolve(result.canonicalPlaceId)
        if (resolved.status !== 'active') throw new Error('import-invariant-violated')
        return { placeId: resolved.placeId }
      },
    }
    let policyWorkerNow = new Date('2026-09-03T01:00:06.000Z')
    let failAfterCanonicalCreation = true
    const interruptedPolicyWorker = new transfersModule.PostgresImportMaterializationWorker(
      database.pool,
      new library.PostgresImportedCollectionMaterializer(database.pool),
      {
        async materialize(input) {
          const result = await sourcePlaceMaterializer.materialize(input)
          if (failAfterCanonicalCreation) {
            failAfterCanonicalCreation = false
            throw new Error('simulated interruption after canonical creation')
          }
          return result
        },
      },
      {
        workerId: 'provider-transfer-worker',
        leaseMilliseconds: 30_000,
        maximumBackoffMilliseconds: 60_000,
        now: () => policyWorkerNow,
      },
    )
    assert.equal(await interruptedPolicyWorker.runOnce(), 'retry-scheduled')
    const createdIdentity = (await database.pool.query(
      `SELECT canonical_place_id FROM places.provider_place_identities
       WHERE provider_key = 'naver' AND external_place_id = 'naver-place-new'`,
    )).rows[0].canonical_place_id
    assert.deepEqual((await database.pool.query(
      `SELECT operation_item.canonical_place_id
       FROM transfers.operation_items AS operation_item
       JOIN transfers.import_plans AS plan ON plan.operation_id = operation_item.operation_id
       JOIN transfers.import_plan_items AS item ON item.plan_id = plan.id
        AND operation_item.item_key = encode(sha256(convert_to(jsonb_build_array(
          item.source_list_id::text, item.source_item_id::text)::text, 'UTF8')), 'hex')
       WHERE plan.id = $1::uuid AND item.source_item_id = 'saved-3'`,
      [planId],
    )).rows, [{ canonical_place_id: null }])
    await database.pool.query(
      `UPDATE ingestion.provider_place_detail_statuses
       SET last_detail_observation_id = $1::uuid, updated_at = $2::timestamptz
       WHERE provider_key = 'naver' AND provider_place_id = 'naver-place-new'`,
      [refreshedDetailObservationId, '2026-09-03T01:00:09.000Z'],
    )
    await assert.rejects(
      database.pool.query(
        `UPDATE transfers.import_plan_items
         SET evidence_source_observation_id = $2::uuid,
             evidence_place_candidate_id = $3::uuid
         WHERE plan_id = $1::uuid AND source_item_id = 'saved-3'`,
        [planId, refreshedDetailObservationId, refreshedDetailCandidateId],
      ),
      /approved import plan items are immutable/i,
    )
    policyWorkerNow = new Date('2026-09-03T01:00:10.000Z')
    const recoveredPolicyWorker = new transfersModule.PostgresImportMaterializationWorker(
      database.pool,
      new library.PostgresImportedCollectionMaterializer(database.pool),
      sourcePlaceMaterializer,
      {
        workerId: 'provider-transfer-policy-recovery-worker',
        leaseMilliseconds: 30_000,
        maximumBackoffMilliseconds: 60_000,
        now: () => policyWorkerNow,
      },
    )
    assert.equal(await recoveredPolicyWorker.runOnce(), 'completed')
    const completedPlan = await transfers.getImportPlanV3(memberId, planId)
    assert.equal(completedPlan.state, 'completed')
    assert.equal(completedPlan.mappings[0].materialization.state, 'applied')
    const replayedApproval = await transfers.applyImportPlanCommandV3(memberId, {
      schemaVersion: 'import-plan-command.v3', kind: 'approve',
      commandId: '01992d41-0000-7000-8000-000000000105',
      planId, expectedPlanRevision: skipped.value.planRevision,
    })
    assert.equal(replayedApproval.status, 'replayed')
    assert.equal(replayedApproval.value.state, 'completed')
    assert.deepEqual((await database.pool.query(
      `SELECT operation.state, operation.stage, operation.processed_count,
              operation.applied_count, plan.state AS plan_state,
              mapping.materialization_state
       FROM transfers.operations AS operation
       JOIN transfers.import_plans AS plan ON plan.operation_id = operation.id
       JOIN transfers.import_plan_mappings AS mapping ON mapping.plan_id = plan.id
       WHERE plan.id = $1::uuid`,
      [planId],
    )).rows, [{
      state: 'completed', stage: 'library-completed', processed_count: 2,
      applied_count: 2, plan_state: 'completed', materialization_state: 'applied',
    }])
    assert.deepEqual((await database.pool.query(
      `SELECT command_kind, result FROM transfers.command_receipts WHERE command_id = $1::uuid`,
      ['01992d41-0000-7000-8000-000000000105'],
    )).rows[0], {
      command_kind: 'import-plan-v3-approve',
      result: {
        reference: {
          kind: 'import-plan', id: planId, acceptedRevision: approved.value.planRevision,
        },
      },
    })

    const collection = await database.pool.query(
      `SELECT collection.visibility, collection.publication_id, placed.canonical_place_id
       FROM library.collections AS collection
       JOIN library.collection_places AS placed ON placed.collection_id = collection.id
       WHERE collection.id = $1::uuid`,
      [collectionId],
    )
    assert.equal(collection.rows.length, 2)
    assert.deepEqual(collection.rows.map((row) => row.canonical_place_id).sort(),
      [placeId, createdIdentity].sort())
    assert.deepEqual((await database.pool.query(
      `SELECT operation_item.canonical_place_id
       FROM transfers.operation_items AS operation_item
       JOIN transfers.import_plans AS plan ON plan.operation_id = operation_item.operation_id
       JOIN transfers.import_plan_items AS item ON item.plan_id = plan.id
        AND operation_item.item_key = encode(sha256(convert_to(jsonb_build_array(
          item.source_list_id::text, item.source_item_id::text)::text, 'UTF8')), 'hex')
       WHERE plan.id = $1::uuid AND item.source_item_id = 'saved-3'`,
      [planId],
    )).rows, [{ canonical_place_id: createdIdentity }])
    assert.deepEqual((await database.pool.query(
      `SELECT
         (SELECT count(*)::int FROM ingestion.source_observations
          WHERE provider_key = 'naver' AND external_place_id = 'naver-place-new') AS observations,
         (SELECT count(*)::int FROM ingestion.place_candidates AS candidate
          JOIN ingestion.source_observations AS observation
            ON observation.id = candidate.source_observation_id
          WHERE observation.external_place_id = 'naver-place-new') AS candidates,
         (SELECT count(*)::int FROM ingestion.resolution_decisions AS decision
          JOIN ingestion.place_candidates AS candidate ON candidate.id = decision.candidate_id
          JOIN ingestion.source_observations AS observation
            ON observation.id = candidate.source_observation_id
          WHERE observation.external_place_id = 'naver-place-new') AS decisions`,
    )).rows[0], { observations: 2, candidates: 2, decisions: 1 })
    assert.deepEqual((await database.pool.query(
      `SELECT decision.candidate_id, decision.evidence_observation_ids,
              decision.decided_at
       FROM ingestion.resolution_decisions AS decision
       JOIN ingestion.place_candidates AS candidate ON candidate.id = decision.candidate_id
       JOIN ingestion.source_observations AS observation
         ON observation.id = candidate.source_observation_id
       WHERE observation.external_place_id = 'naver-place-new'`,
    )).rows, [{
      candidate_id: detailCandidateId,
      evidence_observation_ids: [detailObservationId],
      decided_at: new Date('2026-09-03T01:00:04.000Z'),
    }])

    const cancellationPlan = await transfers.applyImportPlanCommandV3(memberId, {
      schemaVersion: 'import-plan-command.v3', kind: 'create',
      commandId: '01992d41-0000-7000-8000-000000000121',
      planId: cancelledPlanId, snapshotId,
      expectedSnapshotVersion: recorded.snapshot.snapshotVersion,
      mappings: [{
        sourceListId: 'ramen-list',
        target: {
          kind: 'existing', collectionId,
          expectedCollectionRevision:
            completedPlan.mappings[0].materialization.collectionRevision,
        },
      }],
    })
    const cancellationSkipped = await transfers.applyImportPlanCommandV3(memberId, {
      schemaVersion: 'import-plan-command.v3', kind: 'decide-item',
      commandId: '01992d41-0000-7000-8000-000000000122',
      planId: cancelledPlanId,
      expectedPlanRevision: cancellationPlan.value.planRevision,
      sourceListId: 'ramen-list', sourceItemId: 'saved-2', decision: { kind: 'skip' },
    })
    await transfers.applyImportPlanCommandV3(memberId, {
      schemaVersion: 'import-plan-command.v3', kind: 'approve',
      commandId: '01992d41-0000-7000-8000-000000000123',
      planId: cancelledPlanId,
      expectedPlanRevision: cancellationSkipped.value.planRevision,
    })
    const cancellingPolicyWorker = new transfersModule.PostgresImportMaterializationWorker(
      database.pool,
      new library.PostgresImportedCollectionMaterializer(database.pool),
      {
        async materialize(input) {
          const result = await sourcePlaceMaterializer.materialize(input)
          await database.pool.query(
            `UPDATE transfers.operations SET cancel_requested = true,
               revision = revision + 1, updated_at = $2::timestamptz
             WHERE resource_id = $1::uuid AND kind = 'import-materialization'`,
            [cancelledPlanId, '2026-09-03T01:00:12.000Z'],
          )
          return result
        },
      },
      {
        workerId: 'provider-transfer-policy-cancel-worker',
        leaseMilliseconds: 30_000,
        maximumBackoffMilliseconds: 60_000,
        now: () => new Date('2026-09-03T01:00:12.000Z'),
      },
    )
    assert.equal(await cancellingPolicyWorker.runOnce(), 'cancelled')
    assert.deepEqual((await database.pool.query(
      `SELECT operation.state, operation_item.canonical_place_id
       FROM transfers.operations AS operation
       JOIN transfers.operation_items AS operation_item
         ON operation_item.operation_id = operation.id
       JOIN transfers.import_plan_items AS item ON item.plan_id = operation.resource_id
        AND operation_item.item_key = encode(sha256(convert_to(jsonb_build_array(
          item.source_list_id::text, item.source_item_id::text)::text, 'UTF8')), 'hex')
       WHERE operation.resource_id = $1::uuid AND item.source_item_id = 'saved-3'`,
      [cancelledPlanId],
    )).rows, [{ state: 'cancelled', canonical_place_id: createdIdentity }])

    const manualSnapshot = await transfers.recordSourceSnapshot({
      snapshotId: manualSnapshotId,
      ownerMemberId: memberId,
      connectionId,
      providerKey: 'naver',
      sourceRevision: 'manual-review-only',
      provenance: { acquisitionKind: 'manual-capture', parserVersion: 'manual-capture.v1' },
      observedAt: '2026-09-03T01:00:07.000Z',
      capturedAt: '2026-09-03T01:00:08.000Z',
      lists: [{
        sourceListId: 'manual-list', observedName: '직접 캡처', sourcePosition: 0,
        items: [{
          sourceItemId: 'manual-item', providerPlaceId: 'naver-manual-place',
          observedName: '검토할 장소', observedAddress: null, observedCategory: null,
          observedLocation: null,
          match: { status: 'unresolved', reason: 'missing-identity' }, sourcePosition: 0,
        }],
      }],
    })
    const manualPlan = await transfers.applyImportPlanCommandV3(memberId, {
      schemaVersion: 'import-plan-command.v3', kind: 'create',
      commandId: '01992d41-0000-7000-8000-000000000117',
      planId: manualPlanId, snapshotId: manualSnapshotId,
      expectedSnapshotVersion: manualSnapshot.snapshot.snapshotVersion,
      mappings: [{
        sourceListId: 'manual-list',
        target: { kind: 'new', collectionId: manualCollectionId, name: '직접 캡처' },
      }],
    })
    assert.deepEqual(manualPlan.value.approval, {
      eligible: false, reason: 'unresolved-places',
    })
    assert.deepEqual(manualPlan.value.mappings[0].preview.items[0], {
      sourceItemId: 'manual-item', providerPlaceId: 'naver-manual-place',
      observedName: '검토할 장소', observedAddress: null, placeId: null,
      status: 'unresolved', decision: 'none',
    })

    const outbound = await transfers.applyOutboundTransferCommand(memberId, {
      schemaVersion: 'outbound-transfer-command.v2', kind: 'preview',
      commandId: '01992d41-0000-7000-8000-000000000106',
      transferId, connectionId, collectionId,
      expectedCollectionRevision: completedPlan.mappings[0].materialization.collectionRevision,
      selection: { kind: 'all' }, target: { kind: 'new-list', name: '네이버 라멘' },
    })
    assert.equal(outbound.value.state, 'blocked')
    assert.deepEqual({ ...outbound.value.preview, items: [] }, {
      availability: 'unavailable', addCount: null, alreadyPresentCount: null,
      unresolvedCount: null, unsupportedCount: null,
      items: [],
    })
    assert.deepEqual(outbound.value.preview.items.map((item) => item.placeId).sort(),
      [placeId, createdIdentity].sort())
    assert.equal(outbound.value.preview.items.every(
      (item) => item.status === 'unknown' && item.targetProviderPlaceId === null,
    ), true)
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
          items: input.items.map((item) => ({
            placeId: item.placeId,
            status: 'add',
            targetProviderPlaceId: 'naver-place-1',
          })),
        }
      },
    }
    const targetTransfers = new transfersModule.PostgresProviderTransfers({
      pool: database.pool,
      collections: new library.PostgresCollectionTransferReader(database.pool),
      enabledConnectionAuthMethods: { naver: ['browser-session'] },
      targets: [replayTarget],
      now: () => new Date(at),
    })
    const previewCommand = {
      schemaVersion: 'outbound-transfer-command.v2', kind: 'preview',
      commandId: '01992d41-0000-7000-8000-000000000108',
      transferId: approvedTransferId, connectionId, collectionId,
      expectedCollectionRevision: completedPlan.mappings[0].materialization.collectionRevision,
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
      provenance: { acquisitionKind: 'browser-network', parserVersion: 'test-naver.v1' },
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
    const recoveryPlan = await transfers.applyImportPlanCommandV2(memberId, {
      schemaVersion: 'import-plan-command.v2', kind: 'create',
      commandId: '01992d41-0000-7000-8000-000000000110',
      planId: secondPlanId,
      snapshotId: secondSnapshotId,
      expectedSnapshotVersion: crashSnapshot.snapshot.snapshotVersion,
      mappings: ['recovery-0', 'recovery-1'].map((sourceListId) => ({
        sourceListId,
        target: {
          kind: 'existing', collectionId,
          expectedCollectionRevision: completedPlan.mappings[0].materialization.collectionRevision,
        },
      })),
    })
    const realMaterializer = new library.PostgresImportedCollectionMaterializer(database.pool)
    let materializationCalls = 0
    let recoveryWorkerNow = new Date('2026-09-03T01:01:00.000Z')
    const crashingWorker = new transfersModule.PostgresImportMaterializationWorker(
      database.pool,
      {
        async materialize(input) {
          materializationCalls += 1
          if (materializationCalls === 2) throw new Error('simulated process interruption')
          return realMaterializer.materialize(input)
        },
      },
      sourcePlaceMaterializer,
      {
        workerId: 'provider-transfer-crash-worker',
        leaseMilliseconds: 30_000,
        maximumBackoffMilliseconds: 60_000,
        now: () => recoveryWorkerNow,
      },
    )
    const recoveryApproval = {
      schemaVersion: 'import-plan-command.v2', kind: 'approve',
      commandId: '01992d41-0000-7000-8000-000000000111',
      planId: secondPlanId,
      expectedPlanRevision: recoveryPlan.value.planRevision,
    }
    const queuedRecovery = await transfers.applyImportPlanCommandV2(memberId, recoveryApproval)
    assert.equal(queuedRecovery.value.state, 'applying')
    assert.equal(await crashingWorker.runOnce(), 'retry-scheduled')
    assert.deepEqual((await transfers.getImportPlanV2(memberId, secondPlanId)).mappings.map(
      (mapping) => mapping.materialization.state,
    ), ['applied', 'pending'])
    recoveryWorkerNow = new Date('2026-09-03T01:01:10.000Z')
    const recoveryWorker = new transfersModule.PostgresImportMaterializationWorker(
      database.pool,
      realMaterializer,
      sourcePlaceMaterializer,
      {
        workerId: 'provider-transfer-recovery-worker',
        leaseMilliseconds: 30_000,
        maximumBackoffMilliseconds: 60_000,
        now: () => recoveryWorkerNow,
      },
    )
    assert.equal(await recoveryWorker.runOnce(), 'completed')
    const recovered = await transfers.applyImportPlanCommandV2(memberId, recoveryApproval)
    assert.equal(recovered.status, 'replayed')
    assert.equal(recovered.value.state, 'completed')
    assert.deepEqual(
      recovered.value.mappings.map((mapping) => mapping.materialization.state),
      ['applied', 'applied'],
    )
    assert.deepEqual((await database.pool.query(
      `SELECT operation.state, operation.stage, operation.attempt_count,
              operation.processed_count, operation.applied_count,
              plan.state AS plan_state
       FROM transfers.operations AS operation
       JOIN transfers.import_plans AS plan ON plan.operation_id = operation.id
       WHERE plan.id = $1::uuid`,
      [secondPlanId],
    )).rows, [{
      state: 'completed', stage: 'library-completed', attempt_count: 2,
      processed_count: 2, applied_count: 2, plan_state: 'completed',
    }])
    assert.equal((await database.pool.query(
      'SELECT count(*)::int AS count FROM library.collection_places WHERE collection_id = $1::uuid',
      [collectionId],
    )).rows[0].count, 4)
  } finally {
    await database.close()
  }
})
