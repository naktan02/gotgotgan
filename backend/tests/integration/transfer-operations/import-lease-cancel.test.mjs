import assert from 'node:assert/strict'
import test from 'node:test'

import {
  startReadyTransferOperationsFixture,
  transferOperationDigest,
  transferOperationEvidence,
  transferOperationId,
  transferOperationIds,
} from './transfer-operations-postgres-fixture.mjs'

test('import materialization fences expired leases and honors cancellation at commit', {
  timeout: 240_000,
}, async () => {
  const fixture = await startReadyTransferOperationsFixture(
    'gotgotgan-transfer-import-materialization',
  )
  const { database, transfersModule } = fixture
  const { memberId, connectionId, placeId } = transferOperationIds
  const { at } = transferOperationEvidence

  try {
    async function seedImportMaterialization(base) {
      const snapshotId = transferOperationId(base)
      const planId = transferOperationId(base + 1)
      const operationId = transferOperationId(base + 2)
      const targetCollectionId = transferOperationId(base + 3)
      const approvalCommandId = transferOperationId(base + 4)
      const materializationOperationId = transferOperationId(base + 5)
      const sourceListId = `worker-list-${base}`
      const sourceItemId = `worker-item-${base}`
      const client = await database.pool.connect()
      try {
        await client.query('BEGIN')
        await client.query(
          `INSERT INTO transfers.source_snapshots (
             id, owner_membership_id, connection_id, provider_key, source_revision,
             content_digest, observed_at, captured_at
           ) VALUES ($1::uuid,$2::uuid,$3::uuid,'naver',$4,$5,
             $6::timestamptz,$6::timestamptz)`,
          [snapshotId, memberId, connectionId, `worker-source-${base}`,
            transferOperationDigest(`worker-source-${base}`), at],
        )
        await client.query(
          `INSERT INTO transfers.source_snapshot_lists (
             snapshot_id, source_list_id, observed_name, source_position
           ) VALUES ($1::uuid,$2,$3,0)`,
          [snapshotId, sourceListId, `작업 목록 ${base}`],
        )
        await client.query(
          `INSERT INTO transfers.source_snapshot_items (
             snapshot_id, source_list_id, source_item_id, provider_place_id,
             observed_name, canonical_place_id, match_reason, source_position
           ) VALUES ($1::uuid,$2,$3,$4,$5,$6::uuid,NULL,0)`,
          [snapshotId, sourceListId, sourceItemId, `provider-place-${base}`,
            `작업 장소 ${base}`, placeId],
        )
        await client.query(
          `INSERT INTO transfers.operations (
             id, owner_membership_id, kind, provider_key, connection_id, account_label,
             resource_kind, resource_id, stage, state, total_count, created_at, updated_at
           ) VALUES ($1::uuid,$2::uuid,'import-materialization','naver',$3::uuid,$4,
             'import-plan',$5::uuid,'queued-for-materialization','queued',1,
             $6::timestamptz,$6::timestamptz)`,
          [operationId, memberId, connectionId, '검증된 네이버 계정', planId, at],
        )
        await client.query(
          `INSERT INTO transfers.import_plans (
             id, owner_membership_id, snapshot_id, snapshot_digest, state,
             approval_command_id, created_at, updated_at, operation_id
           ) VALUES ($1::uuid,$2::uuid,$3::uuid,$4,'applying',$5::uuid,
             $6::timestamptz,$6::timestamptz,$7::uuid)`,
          [planId, memberId, snapshotId, transferOperationDigest(`worker-source-${base}`),
            approvalCommandId, at, operationId],
        )
        await client.query(
          `INSERT INTO transfers.import_plan_source_lists (plan_id, snapshot_id, source_list_id)
           VALUES ($1::uuid,$2::uuid,$3)`,
          [planId, snapshotId, sourceListId],
        )
        await client.query(
          `INSERT INTO transfers.import_plan_mappings (
             plan_id, source_list_id, target_kind, target_collection_id, target_name,
             materialization_state, materialization_operation_id
           ) VALUES ($1::uuid,$2,'new',$3::uuid,$4,'pending',$5::uuid)`,
          [planId, sourceListId, targetCollectionId, `가져온 목록 ${base}`,
            materializationOperationId],
        )
        await client.query(
          `INSERT INTO transfers.import_plan_items (
             plan_id, source_list_id, source_item_id, resolved_place_id,
             preview_status, decision_kind
           ) VALUES ($1::uuid,$2,$3,$4::uuid,'add','snapshot-match')`,
          [planId, sourceListId, sourceItemId, placeId],
        )
        await client.query(
          `INSERT INTO transfers.operation_items (
             operation_id, item_key, canonical_place_id, status, source_position, updated_at
           ) VALUES ($1::uuid,
             encode(sha256(convert_to(jsonb_build_array($2::text,$3::text)::text,'UTF8')),'hex'),
             $4::uuid,'pending',0,$5::timestamptz)`,
          [operationId, sourceListId, sourceItemId, placeId, at],
        )
        await client.query('COMMIT')
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined)
        throw error
      } finally {
        client.release()
      }
      return { planId, operationId, targetCollectionId }
    }

    function appliedMaterialization(input, version) {
      return {
        status: 'applied',
        operationId: input.context.operationId,
        value: {
          collectionId: input.target.collectionId,
          version,
          bindingVersion: `binding-${version}`,
          membershipCount: input.items.length,
        },
      }
    }

    const fencedImport = await seedImportMaterialization(900)
    let workerNow = new Date('2026-09-03T03:00:00.000Z')
    let releaseFirstWorker
    let firstWorkerStarted
    const firstWorkerReady = new Promise((resolve) => { firstWorkerStarted = resolve })
    const firstWorkerRelease = new Promise((resolve) => { releaseFirstWorker = resolve })
    const firstWorker = new transfersModule.PostgresImportMaterializationWorker(
      database.pool,
      {
        async materialize(input) {
          firstWorkerStarted()
          await firstWorkerRelease
          return appliedMaterialization(input, 'stale-worker-version')
        },
      },
      {
        workerId: 'stage10-worker-a',
        leaseMilliseconds: 30_000,
        maximumBackoffMilliseconds: 60_000,
        now: () => workerNow,
      },
    )
    const firstWorkerRun = firstWorker.runOnce()
    await firstWorkerReady
    workerNow = new Date('2026-09-03T03:01:00.000Z')
    const secondWorker = new transfersModule.PostgresImportMaterializationWorker(
      database.pool,
      {
        async materialize(input) {
          return appliedMaterialization(input, 'winning-worker-version')
        },
      },
      {
        workerId: 'stage10-worker-b',
        leaseMilliseconds: 30_000,
        maximumBackoffMilliseconds: 60_000,
        now: () => workerNow,
      },
    )
    assert.equal(await secondWorker.runOnce(), 'completed')
    releaseFirstWorker()
    assert.equal(await firstWorkerRun, 'lease-lost')
    assert.deepEqual((await database.pool.query(
      `SELECT operation.state, operation.lease_generation::int,
              mapping.collection_version
       FROM transfers.operations AS operation
       JOIN transfers.import_plan_mappings AS mapping ON mapping.plan_id = operation.resource_id
       WHERE operation.id = $1::uuid`,
      [fencedImport.operationId],
    )).rows[0], {
      state: 'completed',
      lease_generation: 2,
      collection_version: 'winning-worker-version',
    })

    const cancelledImport = await seedImportMaterialization(920)
    let releaseCancelledWorker
    let cancelledWorkerStarted
    const cancelledWorkerReady = new Promise((resolve) => { cancelledWorkerStarted = resolve })
    const cancelledWorkerRelease = new Promise((resolve) => { releaseCancelledWorker = resolve })
    const cancellingWorker = new transfersModule.PostgresImportMaterializationWorker(
      database.pool,
      {
        async materialize(input) {
          cancelledWorkerStarted()
          await cancelledWorkerRelease
          return appliedMaterialization(input, 'cancel-race-version')
        },
      },
      {
        workerId: 'stage10-worker-c',
        leaseMilliseconds: 30_000,
        maximumBackoffMilliseconds: 60_000,
        now: () => new Date('2026-09-03T03:02:00.000Z'),
      },
    )
    const cancellingRun = cancellingWorker.runOnce()
    await cancelledWorkerReady
    const operations = new transfersModule.PostgresTransferOperations(
      database.pool,
      () => new Date('2026-09-03T02:00:04.000Z'),
    )
    const runningImport = await operations.get(memberId, cancelledImport.operationId)
    const requestedImportCancel = await operations.command(memberId, {
      commandId: transferOperationId(926),
      operationId: cancelledImport.operationId,
      expectedOperationRevision: runningImport.operationRevision,
      action: 'cancel',
    })
    assert.equal(requestedImportCancel.value.state, 'running')
    releaseCancelledWorker()
    assert.equal(await cancellingRun, 'cancelled')
    assert.deepEqual((await database.pool.query(
      `SELECT operation.state, operation.applied_count,
              plan.state AS plan_state, mapping.materialization_state
       FROM transfers.operations AS operation
       JOIN transfers.import_plans AS plan ON plan.id = operation.resource_id
       JOIN transfers.import_plan_mappings AS mapping ON mapping.plan_id = plan.id
       WHERE operation.id = $1::uuid`,
      [cancelledImport.operationId],
    )).rows[0], {
      state: 'cancelled',
      applied_count: 1,
      plan_state: 'cancelled',
      materialization_state: 'applied',
    })
  } finally {
    await fixture.close()
  }
})
