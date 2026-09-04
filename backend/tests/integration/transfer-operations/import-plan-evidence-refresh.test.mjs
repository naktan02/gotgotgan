import assert from 'node:assert/strict'
import test from 'node:test'

import {
  startReadyTransferOperationsFixture,
  transferOperationEvidence,
  transferOperationId,
  transferOperationIds,
} from './transfer-operations-postgres-fixture.mjs'

function missingIdentityItem(sourceItemId, providerPlaceId, sourcePosition) {
  return {
    sourceItemId,
    providerPlaceId,
    observedName: `외부 장소 ${sourcePosition + 1}`,
    observedAddress: null,
    observedCategory: null,
    observedLocation: null,
    match: { status: 'unresolved', reason: 'missing-identity' },
    sourcePosition,
  }
}

async function recordSnapshot(transfers, input) {
  return transfers.recordSourceSnapshot({
    snapshotId: input.snapshotId,
    ownerMemberId: transferOperationIds.memberId,
    connectionId: transferOperationIds.connectionId,
    providerKey: 'naver',
    sourceRevision: `source-${input.snapshotId}`,
    provenance: {
      acquisitionKind: 'browser-network',
      parserVersion: 'test-saved-place.v1',
    },
    observedAt: '2026-09-03T02:01:00.000Z',
    capturedAt: '2026-09-03T02:01:01.000Z',
    lists: [{
      sourceListId: 'saved-list',
      observedName: '가져올 목록',
      sourcePosition: 0,
      items: input.items,
    }],
  })
}

async function createPlan(transfers, input) {
  return transfers.applyImportPlanCommandV3(transferOperationIds.memberId, {
    schemaVersion: 'import-plan-command.v3',
    kind: 'create',
    commandId: input.commandId,
    planId: input.planId,
    snapshotId: input.snapshot.snapshot.snapshotId,
    expectedSnapshotVersion: input.snapshot.snapshot.snapshotVersion,
    mappings: [{
      sourceListId: 'saved-list',
      target: {
        kind: 'new',
        collectionId: input.collectionId,
        name: '가져온 목록',
      },
    }],
  })
}

async function makeDetailAvailable(input) {
  const ingestionStore = new input.ingestion.PostgresIngestionStore(input.database.pool)
  await input.ingestion.recordSourceObservation({
    id: input.observationId,
    providerKey: 'naver',
    externalPlaceId: input.providerPlaceId,
    observationKind: 'provider-detail',
    acquisitionKind: 'documented-api',
    payloadChecksum: input.checksum,
    parserVersion: input.parserVersion,
    observedAt: input.at,
    acquiredAt: input.at,
    facts: {
      name: input.name,
      address: null,
      categoryLabel: null,
      location: null,
      attributes: {},
    },
    confidence: 1,
    store: ingestionStore,
  })
  await input.ingestion.recordPlaceCandidate({
    id: input.candidateId,
    sourceObservationId: input.observationId,
    parserVersion: input.parserVersion,
    name: input.name,
    attributes: { providerKey: 'naver', providerPlaceId: input.providerPlaceId },
    createdAt: input.at,
    store: ingestionStore,
  })
  await input.database.pool.query(
    `INSERT INTO ingestion.provider_place_detail_observations (
       provider_key, provider_place_id, source_observation_id,
       place_candidate_id, normalized_at, previous_source_observation_id, change_kind
     ) VALUES ('naver',$1,$2::uuid,$3::uuid,$4::timestamptz,$5::uuid,$6)`,
    [input.providerPlaceId, input.observationId, input.candidateId, input.at,
      input.previousObservationId ?? null,
      input.previousObservationId === undefined ? 'initial' : 'changed'],
  )
  await input.database.pool.query(
    `UPDATE ingestion.provider_place_detail_jobs
     SET state = 'completed', completed_at = $2::timestamptz,
         updated_at = $2::timestamptz
     WHERE provider_key = 'naver' AND provider_place_id = $1
       AND state IN ('queued','waiting')`,
    [input.providerPlaceId, input.at],
  )
  await input.database.pool.query(
    `UPDATE ingestion.provider_place_detail_statuses
     SET status = 'available', last_detail_observation_id = $2::uuid,
         updated_at = $3::timestamptz
     WHERE provider_key = 'naver' AND provider_place_id = $1`,
    [input.providerPlaceId, input.observationId, input.at],
  )
}

function item(plan, sourceItemId) {
  const found = plan.mappings[0].preview.items.find(
    (candidate) => candidate.sourceItemId === sourceItemId,
  )
  assert.notEqual(found, undefined)
  return found
}

async function storedPlan(database, planId) {
  return (await database.pool.query(
    `SELECT revision::text, updated_at
     FROM transfers.import_plans WHERE id = $1::uuid`,
    [planId],
  )).rows[0]
}

async function storedItems(database, planId) {
  return (await database.pool.query(
    `SELECT source_item_id, preview_status, decision_kind,
            evidence_source_observation_id, evidence_place_candidate_id
     FROM transfers.import_plan_items
     WHERE plan_id = $1::uuid
     ORDER BY source_item_id`,
    [planId],
  )).rows
}

function refreshCommand(commandId, planId, expectedPlanRevision) {
  return {
    schemaVersion: 'import-plan-command.v3',
    kind: 'refresh-evidence',
    commandId,
    planId,
    expectedPlanRevision,
  }
}

test('V3 draft refresh pins exact available evidence once and preserves user decisions', {
  timeout: 120_000,
}, async () => {
  const fixture = await startReadyTransferOperationsFixture(
    'gotgotgan-import-plan-evidence-refresh',
  )
  const { database, transfers } = fixture
  const ingestion = await import('../../../dist/modules/ingestion/index.js')
  const snapshotId = transferOperationId(500)
  const planId = transferOperationId(501)
  const collectionId = transferOperationId(502)
  const autoA = 'refresh-auto-a'
  const autoB = 'refresh-auto-b'
  const skippedItem = 'refresh-skipped'
  const linkedItem = 'refresh-linked'
  const observationA = transferOperationId(520)
  const candidateA = transferOperationId(521)
  const observationB = transferOperationId(522)
  const candidateB = transferOperationId(523)
  const refreshedObservationA = transferOperationId(524)
  const refreshedCandidateA = transferOperationId(525)

  try {
    const snapshot = await recordSnapshot(transfers, {
      snapshotId,
      items: [
        missingIdentityItem('auto-a', autoA, 0),
        missingIdentityItem('auto-b', autoB, 1),
        missingIdentityItem('skip', skippedItem, 2),
        missingIdentityItem('link', linkedItem, 3),
      ],
    })
    const created = await createPlan(transfers, {
      commandId: transferOperationId(503), planId, collectionId, snapshot,
    })
    assert.equal(created.status, 'applied')
    assert.deepEqual(created.value.mappings[0].preview.items.map((candidate) => ({
      id: candidate.sourceItemId,
      decision: candidate.decision,
      detail: candidate.providerDetailStatus,
    })), [
      { id: 'auto-a', decision: 'none', detail: 'pending' },
      { id: 'auto-b', decision: 'none', detail: 'pending' },
      { id: 'skip', decision: 'none', detail: 'pending' },
      { id: 'link', decision: 'none', detail: 'pending' },
    ])

    const skipped = await transfers.applyImportPlanCommandV3(
      transferOperationIds.memberId,
      {
        schemaVersion: 'import-plan-command.v3', kind: 'decide-item',
        commandId: transferOperationId(504), planId,
        expectedPlanRevision: created.value.planRevision,
        sourceListId: 'saved-list', sourceItemId: 'skip',
        decision: { kind: 'skip' },
      },
    )
    const linked = await transfers.applyImportPlanCommandV3(
      transferOperationIds.memberId,
      {
        schemaVersion: 'import-plan-command.v3', kind: 'decide-item',
        commandId: transferOperationId(505), planId,
        expectedPlanRevision: skipped.value.planRevision,
        sourceListId: 'saved-list', sourceItemId: 'link',
        decision: { kind: 'link', placeId: transferOperationIds.placeId },
      },
    )
    assert.equal(item(linked.value, 'skip').providerDetailStatus, null)
    assert.equal(item(linked.value, 'link').providerDetailStatus, null)

    await makeDetailAvailable({
      database, ingestion, providerPlaceId: autoA,
      observationId: observationA, candidateId: candidateA,
      checksum: 'a'.repeat(64), parserVersion: 'naver-detail.v1',
      name: '자동 보강 A', at: '2026-09-03T02:10:00.000Z',
    })
    await makeDetailAvailable({
      database, ingestion, providerPlaceId: autoB,
      observationId: observationB, candidateId: candidateB,
      checksum: 'b'.repeat(64), parserVersion: 'naver-detail.v1',
      name: '자동 보강 B', at: '2026-09-03T02:10:01.000Z',
    })

    const beforeRefresh = await storedPlan(database, planId)
    const command = refreshCommand(
      transferOperationId(506), planId, linked.value.planRevision,
    )
    const refreshed = await transfers.applyImportPlanCommandV3(
      transferOperationIds.memberId, command,
    )
    assert.equal(refreshed.status, 'applied')
    assert.equal(Number((await storedPlan(database, planId)).revision),
      Number(beforeRefresh.revision) + 1)
    for (const sourceItemId of ['auto-a', 'auto-b']) {
      assert.deepEqual({
        status: item(refreshed.value, sourceItemId).status,
        decision: item(refreshed.value, sourceItemId).decision,
        detail: item(refreshed.value, sourceItemId).providerDetailStatus,
      }, { status: 'add', decision: 'policy-create', detail: 'available' })
    }
    assert.deepEqual({
      status: item(refreshed.value, 'skip').status,
      decision: item(refreshed.value, 'skip').decision,
      detail: item(refreshed.value, 'skip').providerDetailStatus,
    }, { status: 'skipped', decision: 'skip', detail: null })
    assert.deepEqual({
      status: item(refreshed.value, 'link').status,
      decision: item(refreshed.value, 'link').decision,
      detail: item(refreshed.value, 'link').providerDetailStatus,
    }, { status: 'add', decision: 'link', detail: null })
    assert.deepEqual(await storedItems(database, planId), [{
      source_item_id: 'auto-a', preview_status: 'add', decision_kind: 'policy-create',
      evidence_source_observation_id: observationA,
      evidence_place_candidate_id: candidateA,
    }, {
      source_item_id: 'auto-b', preview_status: 'add', decision_kind: 'policy-create',
      evidence_source_observation_id: observationB,
      evidence_place_candidate_id: candidateB,
    }, {
      source_item_id: 'link', preview_status: 'add', decision_kind: 'link',
      evidence_source_observation_id: null, evidence_place_candidate_id: null,
    }, {
      source_item_id: 'skip', preview_status: 'skipped', decision_kind: 'skip',
      evidence_source_observation_id: null, evidence_place_candidate_id: null,
    }])

    await makeDetailAvailable({
      database, ingestion, providerPlaceId: autoA,
      observationId: refreshedObservationA, candidateId: refreshedCandidateA,
      previousObservationId: observationA,
      checksum: 'c'.repeat(64), parserVersion: 'naver-detail.v2',
      name: '자동 보강 A 갱신', at: '2026-09-03T02:11:00.000Z',
    })
    const replayed = await transfers.applyImportPlanCommandV3(
      transferOperationIds.memberId, command,
    )
    assert.equal(replayed.status, 'replayed')
    assert.equal(replayed.value.planRevision, refreshed.value.planRevision)
    assert.deepEqual((await storedItems(database, planId))[0], {
      source_item_id: 'auto-a', preview_status: 'add', decision_kind: 'policy-create',
      evidence_source_observation_id: observationA,
      evidence_place_candidate_id: candidateA,
    })

    const beforeNoop = await storedPlan(database, planId)
    const noOp = await transfers.applyImportPlanCommandV3(
      transferOperationIds.memberId,
      refreshCommand(transferOperationId(507), planId, refreshed.value.planRevision),
    )
    assert.equal(noOp.status, 'applied')
    assert.equal(noOp.value.planRevision, refreshed.value.planRevision)
    assert.deepEqual(await storedPlan(database, planId), beforeNoop)

    const approved = await transfers.applyImportPlanCommandV3(
      transferOperationIds.memberId,
      {
        schemaVersion: 'import-plan-command.v3', kind: 'approve',
        commandId: transferOperationId(508), planId,
        expectedPlanRevision: noOp.value.planRevision,
      },
    )
    assert.equal(approved.status, 'applied')
    assert.equal(approved.value.state, 'applying')
    const rejected = await transfers.applyImportPlanCommandV3(
      transferOperationIds.memberId,
      refreshCommand(transferOperationId(509), planId, approved.value.planRevision),
    )
    assert.equal(rejected.status, 'rejected')
    assert.deepEqual(rejected.rejection, { code: 'revision-conflict' })
    assert.equal((await storedItems(database, planId))[0].evidence_source_observation_id,
      observationA)
  } finally {
    await fixture.close()
  }
})

test('concurrent evidence refresh and user decision allow exactly one revision winner', {
  timeout: 120_000,
}, async () => {
  const fixture = await startReadyTransferOperationsFixture(
    'gotgotgan-import-plan-evidence-race',
  )
  const { database, transfers } = fixture
  const ingestion = await import('../../../dist/modules/ingestion/index.js')
  const snapshotId = transferOperationId(600)
  const planId = transferOperationId(601)
  const collectionId = transferOperationId(602)
  const providerPlaceId = 'refresh-race-place'

  try {
    const snapshot = await recordSnapshot(transfers, {
      snapshotId,
      items: [missingIdentityItem('race-item', providerPlaceId, 0)],
    })
    const created = await createPlan(transfers, {
      commandId: transferOperationId(603), planId, collectionId, snapshot,
    })
    await makeDetailAvailable({
      database, ingestion, providerPlaceId,
      observationId: transferOperationId(610), candidateId: transferOperationId(611),
      checksum: 'd'.repeat(64), parserVersion: 'naver-detail.v1',
      name: '경합 장소', at: '2026-09-03T02:20:00.000Z',
    })

    const outcomes = await Promise.all([
      transfers.applyImportPlanCommandV3(
        transferOperationIds.memberId,
        refreshCommand(transferOperationId(604), planId, created.value.planRevision),
      ),
      transfers.applyImportPlanCommandV3(transferOperationIds.memberId, {
        schemaVersion: 'import-plan-command.v3', kind: 'decide-item',
        commandId: transferOperationId(605), planId,
        expectedPlanRevision: created.value.planRevision,
        sourceListId: 'saved-list', sourceItemId: 'race-item',
        decision: { kind: 'skip' },
      }),
    ])
    assert.equal(outcomes.filter((outcome) => outcome.status === 'applied').length, 1)
    assert.deepEqual(
      outcomes.filter((outcome) => outcome.status === 'rejected')
        .map((outcome) => outcome.rejection),
      [{ code: 'revision-conflict' }],
    )
    assert.equal(Number((await storedPlan(database, planId)).revision), 2)
    const stored = (await storedItems(database, planId))[0]
    assert.ok(
      stored.decision_kind === 'policy-create' && stored.preview_status === 'add' &&
        stored.evidence_source_observation_id === transferOperationId(610) &&
        stored.evidence_place_candidate_id === transferOperationId(611) ||
      stored.decision_kind === 'skip' && stored.preview_status === 'skipped' &&
        stored.evidence_source_observation_id === null &&
        stored.evidence_place_candidate_id === null,
    )
  } finally {
    await fixture.close()
  }
})

function createProjectionBarrierPool(pool) {
  let headerSeenResolve
  let resumeResolve
  let intercepted = false
  const headerSeen = new Promise((resolve) => { headerSeenResolve = resolve })
  const resume = new Promise((resolve) => { resumeResolve = resolve })
  return {
    pool: {
      query: (...input) => pool.query(...input),
      async connect() {
        const client = await pool.connect()
        return {
          async query(...input) {
            const result = await client.query(...input)
            const statement = typeof input[0] === 'string' ? input[0] : input[0]?.text ?? ''
            if (!intercepted && statement.includes('SELECT plan.id') &&
              statement.includes('FROM transfers.import_plans AS plan')) {
              intercepted = true
              headerSeenResolve()
              await resume
            }
            return result
          },
          release: () => client.release(),
        }
      },
    },
    async waitForHeader() {
      let timeout
      try {
        await Promise.race([
          headerSeen,
          new Promise((_, reject) => {
            timeout = setTimeout(
              () => reject(new Error('projection header was not observed')), 5_000,
            )
          }),
        ])
      } finally {
        clearTimeout(timeout)
      }
    },
    resume: () => resumeResolve(),
  }
}

test('standalone V3 projection cannot mix an old revision with refreshed items', {
  timeout: 120_000,
}, async () => {
  const fixture = await startReadyTransferOperationsFixture(
    'gotgotgan-import-plan-projection-consistency',
  )
  const { database, library, transfers, transfersModule } = fixture
  const ingestion = await import('../../../dist/modules/ingestion/index.js')
  const snapshotId = transferOperationId(650)
  const planId = transferOperationId(651)
  const collectionId = transferOperationId(652)
  const providerPlaceId = 'projection-race-place'

  try {
    const snapshot = await recordSnapshot(transfers, {
      snapshotId,
      items: [missingIdentityItem('projection-item', providerPlaceId, 0)],
    })
    const created = await createPlan(transfers, {
      commandId: transferOperationId(653), planId, collectionId, snapshot,
    })
    await makeDetailAvailable({
      database, ingestion, providerPlaceId,
      observationId: transferOperationId(660), candidateId: transferOperationId(661),
      checksum: 'e'.repeat(64), parserVersion: 'naver-detail.v1',
      name: '투영 경합 장소', at: '2026-09-03T02:30:00.000Z',
    })

    const barrier = createProjectionBarrierPool(database.pool)
    const readTransfers = new transfersModule.PostgresProviderTransfers({
      pool: barrier.pool,
      collections: new library.PostgresCollectionTransferReader(database.pool),
      now: () => new Date(transferOperationEvidence.at),
    })
    const reading = readTransfers.getImportPlanV3(transferOperationIds.memberId, planId)
    await barrier.waitForHeader()
    let refreshed
    try {
      refreshed = await transfers.applyImportPlanCommandV3(
        transferOperationIds.memberId,
        refreshCommand(transferOperationId(654), planId, created.value.planRevision),
      )
    } finally {
      barrier.resume()
    }
    assert.equal(refreshed.status, 'applied')
    const coherent = await reading
    assert.notEqual(coherent, undefined)
    assert.equal(coherent.planRevision, created.value.planRevision)
    assert.equal(item(coherent, 'projection-item').decision, 'none')
    assert.equal(item(coherent, 'projection-item').providerDetailStatus, 'available')
  } finally {
    await fixture.close()
  }
})
