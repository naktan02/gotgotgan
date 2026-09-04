import assert from 'node:assert/strict'
import test from 'node:test'

import {
  connectorCaptureChunk,
  connectorCaptureManifest,
  startReadyTransferOperationsFixture,
  transferOperationEvidence,
  transferOperationId,
  transferOperationIds,
} from './transfer-operations-postgres-fixture.mjs'

const providerPlaceId = 'shared-provider-place'
const unavailableProviderPlaceId = 'unavailable-provider-place'
const concurrentProviderPlaceId = 'concurrent-provider-place'

async function makeDetailAvailable(database, ingestion, providerKey, availableAt) {
  const observationId = transferOperationId(470)
  const candidateId = transferOperationId(471)
  const ingestionStore = new ingestion.PostgresIngestionStore(database.pool)
  await ingestion.recordSourceObservation({
    id: observationId,
    providerKey,
    externalPlaceId: providerPlaceId,
    observationKind: 'provider-detail',
    acquisitionKind: 'documented-api',
    payloadChecksum: 'd'.repeat(64),
    parserVersion: `${providerKey}-place-detail.v1`,
    observedAt: availableAt,
    acquiredAt: availableAt,
    facts: { name: '검증된 장소' },
    confidence: 1,
    store: ingestionStore,
  })
  await ingestion.recordPlaceCandidate({
    id: candidateId,
    sourceObservationId: observationId,
    parserVersion: 'provider-detail-normalizer.v1',
    name: '검증된 장소',
    attributes: { providerKey, providerPlaceId },
    createdAt: availableAt,
    store: ingestionStore,
  })
  await database.pool.query(
    `INSERT INTO ingestion.provider_place_detail_observations (
       provider_key, provider_place_id, source_observation_id,
       place_candidate_id, normalized_at
     ) VALUES ($1,$2,$3::uuid,$4::uuid,$5::timestamptz)`,
    [providerKey, providerPlaceId, observationId, candidateId, availableAt],
  )
  await database.pool.query(
    `UPDATE ingestion.provider_place_detail_jobs
     SET state = 'completed', completed_at = $3::timestamptz,
         updated_at = $3::timestamptz
     WHERE provider_key = $1 AND provider_place_id = $2
       AND state IN ('queued','waiting')`,
    [providerKey, providerPlaceId, availableAt],
  )
  await database.pool.query(
    `UPDATE ingestion.provider_place_detail_statuses
     SET status = 'available', last_detail_observation_id = $3::uuid,
         updated_at = $4::timestamptz
     WHERE provider_key = $1 AND provider_place_id = $2`,
    [providerKey, providerPlaceId, observationId, availableAt],
  )
}

async function detailFollowups(database) {
  return (await database.pool.query(
    `SELECT status.provider_key, status.provider_place_id, status.status,
            count(job.id)::int AS job_count,
            count(job.id) FILTER (
              WHERE job.state IN ('queued','waiting','leased')
            )::int AS active_job_count
     FROM ingestion.provider_place_detail_statuses AS status
     LEFT JOIN ingestion.provider_place_detail_jobs AS job
       ON job.provider_key = status.provider_key
      AND job.provider_place_id = status.provider_place_id
     GROUP BY status.provider_key, status.provider_place_id, status.status
     ORDER BY status.provider_key, status.provider_place_id`,
  )).rows
}

test('saved-place snapshots schedule one detail follow-up per provider identity', {
  timeout: 120_000,
}, async () => {
  const fixture = await startReadyTransferOperationsFixture(
    'gotgotgan-snapshot-detail-followup',
  )
  const { database, connectorCapture, library, transfersModule } = fixture
  const { memberId, connectionId, placeId } = transferOperationIds
  const { accountFingerprint, placeOrigin } = transferOperationEvidence
  const kakaoConnectionId = transferOperationId(400)

  try {
    assert.deepEqual((await database.administratorClient.query(
      `SELECT procedure.prosecdef AS security_definer,
              procedure.proconfig AS configuration,
              has_function_privilege('place_app', procedure.oid, 'EXECUTE')
                AS runtime_execute,
              EXISTS (
                SELECT 1
                FROM aclexplode(coalesce(
                  procedure.proacl,
                  acldefault('f', procedure.proowner)
                )) AS privilege
                WHERE privilege.grantee = 0
                  AND privilege.privilege_type = 'EXECUTE'
              ) AS public_execute
       FROM pg_proc AS procedure
       WHERE procedure.oid =
         'ingestion.schedule_initial_provider_place_details(text,text[],timestamp with time zone)'
           ::regprocedure`,
    )).rows, [{
      security_definer: true,
      configuration: ['search_path=pg_catalog'],
      runtime_execute: true,
      public_execute: false,
    }])

    const ingestion = await import('../../../dist/modules/ingestion/index.js')
    const transfers = new transfersModule.PostgresProviderTransfers({
      pool: database.pool,
      collections: new library.PostgresCollectionTransferReader(database.pool),
      enabledConnectionAuthMethods: {
        naver: ['browser-session'],
        kakao: ['account-export'],
      },
      now: () => new Date('2026-09-03T02:10:00.000Z'),
    })
    const kakaoConnection = await transfers.applyConnectionCommand(memberId, {
      schemaVersion: 'provider-connection-command.v2',
      kind: 'create',
      commandId: transferOperationId(401),
      connectionId: kakaoConnectionId,
      providerKey: 'kakao',
      label: '검증된 카카오 계정',
      authMethod: 'account-export',
    })
    assert.equal(kakaoConnection.status, 'applied')
    const verifiedKakao = await transfers.recordConnectionObservation({
      observationId: transferOperationId(402),
      ownerMemberId: memberId,
      connectionId: kakaoConnectionId,
      expectedConnectionRevision: kakaoConnection.value.connectionRevision,
      observedState: 'ready',
      accountFingerprint: 'c'.repeat(64),
      observedAt: '2026-09-03T02:10:01.000Z',
    })
    assert.equal(verifiedKakao.status, 'applied')

    const trustedCapture = {
      snapshotId: transferOperationId(403),
      ownerMemberId: memberId,
      connectionId: kakaoConnectionId,
      providerKey: 'kakao',
      sourceRevision: 'kakao-library-1',
      provenance: {
        acquisitionKind: 'browser-network',
        parserVersion: 'test-kakao-saved-place.v1',
      },
      observedAt: '2026-09-03T02:10:02.000Z',
      capturedAt: '2026-09-03T02:10:03.000Z',
      lists: [{
        sourceListId: 'saved-list',
        observedName: '내 장소',
        sourcePosition: 0,
        items: [{
          sourceItemId: 'unmatched-1',
          providerPlaceId,
          observedName: '새 장소',
          observedAddress: null,
          observedCategory: null,
          observedLocation: null,
          match: { status: 'unresolved', reason: 'missing-identity' },
          sourcePosition: 0,
        }, {
          sourceItemId: 'unmatched-duplicate',
          providerPlaceId,
          observedName: '같은 새 장소',
          observedAddress: null,
          observedCategory: null,
          observedLocation: null,
          match: { status: 'unresolved', reason: 'missing-identity' },
          sourcePosition: 1,
        }, {
          sourceItemId: 'no-provider-identity',
          providerPlaceId: null,
          observedName: '외부 식별자 없음',
          observedAddress: null,
          observedCategory: null,
          observedLocation: null,
          match: { status: 'unresolved', reason: 'missing-identity' },
          sourcePosition: 2,
        }, {
          sourceItemId: 'ambiguous',
          providerPlaceId: 'ambiguous-provider-place',
          observedName: '모호한 장소',
          observedAddress: null,
          observedCategory: null,
          observedLocation: null,
          match: { status: 'unresolved', reason: 'ambiguous' },
          sourcePosition: 3,
        }, {
          sourceItemId: 'matched',
          providerPlaceId: 'matched-provider-place',
          observedName: '이미 매칭된 장소',
          observedAddress: null,
          observedCategory: null,
          observedLocation: null,
          match: { status: 'matched', placeId },
          sourcePosition: 4,
        }],
      }],
    }
    assert.equal((await transfers.recordSourceSnapshot(trustedCapture)).status, 'applied')
    assert.deepEqual(await detailFollowups(database), [{
      provider_key: 'kakao',
      provider_place_id: providerPlaceId,
      status: 'pending',
      job_count: 1,
      active_job_count: 1,
    }])
    assert.equal((await transfers.recordSourceSnapshot(trustedCapture)).status, 'replayed')
    assert.equal((await database.pool.query(
      `SELECT count(*)::int AS count
       FROM ingestion.provider_place_detail_jobs
       WHERE provider_key = 'kakao' AND provider_place_id = $1`,
      [providerPlaceId],
    )).rows[0].count, 1)

    await makeDetailAvailable(
      database,
      ingestion,
      'kakao',
      '2026-09-03T02:10:04.000Z',
    )
    assert.equal((await transfers.recordSourceSnapshot({
      ...trustedCapture,
      snapshotId: transferOperationId(404),
      sourceRevision: 'kakao-library-2',
      observedAt: '2026-09-03T02:10:05.000Z',
      capturedAt: '2026-09-03T02:10:06.000Z',
    })).status, 'applied')
    assert.deepEqual(await detailFollowups(database), [{
      provider_key: 'kakao',
      provider_place_id: providerPlaceId,
      status: 'available',
      job_count: 1,
      active_job_count: 0,
    }])

    await database.pool.query(
      `INSERT INTO ingestion.provider_place_detail_statuses (
         provider_key, provider_place_id, status, requested_at, updated_at
       ) VALUES ('kakao',$1,'unavailable',$2::timestamptz,$2::timestamptz)`,
      [unavailableProviderPlaceId, '2026-09-03T02:10:07.000Z'],
    )
    const followupItem = trustedCapture.lists[0].items[0]
    const followupList = trustedCapture.lists[0]
    assert.equal((await transfers.recordSourceSnapshot({
      ...trustedCapture,
      snapshotId: transferOperationId(405),
      sourceRevision: 'kakao-library-3',
      observedAt: '2026-09-03T02:10:08.000Z',
      capturedAt: '2026-09-03T02:10:09.000Z',
      lists: [{
        ...followupList,
        items: [{
          ...followupItem,
          sourceItemId: 'terminal-unavailable',
          providerPlaceId: unavailableProviderPlaceId,
        }],
      }],
    })).status, 'applied')
    assert.equal((await database.pool.query(
      `SELECT count(*)::int AS count
       FROM ingestion.provider_place_detail_jobs
       WHERE provider_key = 'kakao' AND provider_place_id = $1`,
      [unavailableProviderPlaceId],
    )).rows[0].count, 0)

    const concurrentCapture = {
      ...trustedCapture,
      snapshotId: transferOperationId(406),
      sourceRevision: 'kakao-library-4',
      observedAt: '2026-09-03T02:10:10.000Z',
      capturedAt: '2026-09-03T02:10:11.000Z',
      lists: [{
        ...followupList,
        items: [{
          ...followupItem,
          sourceItemId: 'concurrent-a',
          providerPlaceId: concurrentProviderPlaceId,
        }],
      }],
    }
    const concurrentResults = await Promise.all([
      transfers.recordSourceSnapshot(concurrentCapture),
      transfers.recordSourceSnapshot({
        ...concurrentCapture,
        snapshotId: transferOperationId(407),
        sourceRevision: 'kakao-library-5',
        observedAt: '2026-09-03T02:10:12.000Z',
        capturedAt: '2026-09-03T02:10:13.000Z',
        lists: [{
          ...followupList,
          items: [{
            ...followupItem,
            sourceItemId: 'concurrent-b',
            providerPlaceId: concurrentProviderPlaceId,
          }],
        }],
      }),
    ])
    assert.deepEqual(concurrentResults.map((result) => result.status), ['applied', 'applied'])
    assert.equal((await database.pool.query(
      `SELECT count(*)::int AS count
       FROM ingestion.provider_place_detail_jobs
       WHERE provider_key = 'kakao' AND provider_place_id = $1`,
      [concurrentProviderPlaceId],
    )).rows[0].count, 1)

    const connectorPayload = JSON.stringify({
      lists: [{
        sourceListId: 'connector-list',
        observedName: '커넥터 장소',
        sourcePosition: 0,
        items: [{
          sourceItemId: 'connector-item',
          providerPlaceId,
          observedName: '네이버의 같은 외부 ID 장소',
          observedAddress: null,
          observedCategory: null,
          observedLocation: null,
          sourcePosition: 0,
        }],
      }],
    })
    const connectorChunk = {
      payload: connectorPayload,
      ...connectorCaptureChunk(0, connectorPayload, 1),
    }
    const operationId = transferOperationId(410)
    const manifestId = transferOperationId(411)
    const installationId = transferOperationId(412)
    const manifest = connectorCaptureManifest({
      captureManifestDigestInput: connectorCapture.captureManifestDigestInput,
      operationId,
      manifestId,
      installationId,
      sourceRevision: 'naver-library-1',
      chunks: [connectorChunk],
      listCount: 1,
      itemCount: 1,
    })
    let receiverId = 420
    const receiver = new transfersModule.PostgresConnectorCaptures(database.pool, {
      grantTtlMilliseconds: 300_000,
      maximumChunkBytes: 1_048_576,
      nextId: () => transferOperationId(receiverId++),
      nextToken: () => 'snapshot-detail-followup-token',
      now: () => new Date('2026-09-03T02:11:00.000Z'),
    })
    const grant = await receiver.issueImportGrant(memberId, {
      commandId: transferOperationId(413),
      operationId,
      connectionId,
      expectedConnectionRevision: fixture.verifiedConnection.value.connectionRevision,
      providerKey: 'naver',
      accountFingerprint,
      installationId,
      placeOrigin,
      manifest,
    })
    assert.equal(grant.status, 'applied')
    await receiver.recordChunk({
      token: grant.value.token,
      sourceOrigin: placeOrigin,
      chunk: { operationId, manifestId, ...connectorChunk },
    })
    assert.equal((await receiver.complete({
      token: grant.value.token,
      sourceOrigin: placeOrigin,
      operationId,
      manifest,
    })).outcome, 'completed')
    assert.equal((await receiver.complete({
      token: grant.value.token,
      sourceOrigin: placeOrigin,
      operationId,
      manifest,
    })).outcome, 'replayed')
    assert.deepEqual(await detailFollowups(database), [{
      provider_key: 'kakao',
      provider_place_id: concurrentProviderPlaceId,
      status: 'pending',
      job_count: 1,
      active_job_count: 1,
    }, {
      provider_key: 'kakao',
      provider_place_id: providerPlaceId,
      status: 'available',
      job_count: 1,
      active_job_count: 0,
    }, {
      provider_key: 'kakao',
      provider_place_id: unavailableProviderPlaceId,
      status: 'unavailable',
      job_count: 0,
      active_job_count: 0,
    }, {
      provider_key: 'naver',
      provider_place_id: providerPlaceId,
      status: 'pending',
      job_count: 1,
      active_job_count: 1,
    }])
  } finally {
    await fixture.close()
  }
})
