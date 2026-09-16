import assert from 'node:assert/strict'
import test from 'node:test'

import { startPreparedPlaceDatabase } from './support/prepared-place-database.mjs'

test('provider detail refresh appends change evidence and preserves the last good detail', { timeout: 90_000 }, async () => {
  const database = await startPreparedPlaceDatabase('provider-place-details')
  try {
    const ingestion = await import('../../dist/modules/ingestion/index.js')
    const ids = {
      job: '01993010-0000-7000-8000-000000000001',
      observation: '01993010-0000-7000-8000-000000000002',
      candidate: '01993010-0000-7000-8000-000000000003',
    }
    const at = '2026-08-28T04:00:00.000Z'
    await database.pool.query(
      `INSERT INTO ingestion.provider_place_detail_statuses (
         provider_key, provider_place_id, status, requested_at, updated_at
       ) VALUES ('naver', 'naver-place-fixture', 'pending', $1::timestamptz, $1::timestamptz)`,
      [at],
    )
    await database.pool.query(
      `INSERT INTO ingestion.provider_place_detail_jobs (
         id, provider_key, provider_place_id, state, available_at,
         observation_id, candidate_id, created_at, updated_at
       ) VALUES (
         $1::uuid, 'naver', 'naver-place-fixture', 'queued', $2::timestamptz,
         $3::uuid, $4::uuid, $2::timestamptz, $2::timestamptz
       )`,
      [ids.job, at, ids.observation, ids.candidate],
    )

    const details = new ingestion.PostgresProviderPlaceDetails(database.pool)
    const worker = ingestion.createProviderPlaceDetailWorker({
      workerId: 'provider-detail-integration-worker',
      store: details,
      ingestionStore: new ingestion.PostgresIngestionStore(database.pool),
      sources: [{
        providerKey: 'naver',
        fetch: async () => ({
          kind: 'available',
          detail: {
            acquisitionKind: 'structured-web',
            payloadChecksum: 'b'.repeat(64),
            parserVersion: 'naver-place-detail.v1',
            observedAt: at,
            name: '검증 장소',
            address: '대한민국 서울특별시',
            categoryLabel: '공공기관',
            location: { latitude: 37.5665, longitude: 126.978 },
            attributes: { businessStatus: 'open' },
            confidence: 0.9,
          },
        }),
      }],
      now: () => new Date(at),
      leaseMilliseconds: 60_000,
      maximumAttempts: 3,
      retryBaseMilliseconds: 30_000,
    })

    assert.deepEqual(await worker.runOne(), {
      status: 'completed',
      jobId: ids.job,
      observationId: ids.observation,
    })
    assert.deepEqual(await worker.runOne(), { status: 'idle' })

    const state = await database.administratorClient.query(
      `SELECT
         detail.status AS detail_status,
         detail.last_detail_observation_id,
         job.state AS job_state,
         job.attempt_count,
         attempt.outcome_kind,
         observation.observation_kind,
         candidate.source_observation_id,
         (SELECT count(*)::int FROM places.canonical_places) AS canonical_places
       FROM ingestion.provider_place_detail_statuses AS detail
       JOIN ingestion.provider_place_detail_jobs AS job
         ON job.provider_key = detail.provider_key
        AND job.provider_place_id = detail.provider_place_id
       JOIN ingestion.provider_place_detail_attempts AS attempt ON attempt.job_id = job.id
       JOIN ingestion.source_observations AS observation
         ON observation.id = detail.last_detail_observation_id
       JOIN ingestion.place_candidates AS candidate
         ON candidate.source_observation_id = observation.id
       WHERE detail.provider_key = 'naver'
         AND detail.provider_place_id = 'naver-place-fixture'`,
    )
    assert.deepEqual(state.rows, [{
      detail_status: 'available',
      last_detail_observation_id: ids.observation,
      job_state: 'completed',
      attempt_count: 1,
      outcome_kind: 'completed',
      observation_kind: 'provider-detail',
      source_observation_id: ids.observation,
      canonical_places: 0,
    }])

    const secondAt = '2026-09-05T04:00:00.000Z'
    assert.equal(await details.scheduleStale({
      providerKeys: ['naver'],
      staleBefore: '2026-08-29T04:00:00.000Z',
      scheduledAt: secondAt,
      limit: 10,
    }), 1)
    const unchangedWorker = ingestion.createProviderPlaceDetailWorker({
      workerId: 'provider-detail-refresh-worker',
      store: details,
      ingestionStore: new ingestion.PostgresIngestionStore(database.pool),
      sources: [{
        providerKey: 'naver',
        fetch: async () => ({
          kind: 'available',
          detail: {
            acquisitionKind: 'structured-web',
            payloadChecksum: 'b'.repeat(64),
            parserVersion: 'naver-place-detail.v1',
            observedAt: secondAt,
            name: '검증 장소',
            address: '대한민국 서울특별시',
            categoryLabel: '공공기관',
            location: { latitude: 37.5665, longitude: 126.978 },
            attributes: { businessStatus: 'open' },
            confidence: 0.9,
          },
        }),
      }],
      now: () => new Date(secondAt),
      leaseMilliseconds: 60_000,
      maximumAttempts: 3,
      retryBaseMilliseconds: 30_000,
    })
    const unchanged = await unchangedWorker.runOne()
    assert.equal(unchanged.status, 'completed')

    const thirdAt = '2026-09-12T04:00:00.000Z'
    assert.equal(await details.scheduleStale({
      providerKeys: ['naver'],
      staleBefore: '2026-09-06T04:00:00.000Z',
      scheduledAt: thirdAt,
      limit: 10,
    }), 1)
    const changedWorker = ingestion.createProviderPlaceDetailWorker({
      workerId: 'provider-detail-change-worker',
      store: details,
      ingestionStore: new ingestion.PostgresIngestionStore(database.pool),
      sources: [{
        providerKey: 'naver',
        fetch: async () => ({
          kind: 'available',
          detail: {
            acquisitionKind: 'structured-web',
            payloadChecksum: 'c'.repeat(64),
            parserVersion: 'naver-place-detail.v1',
            observedAt: thirdAt,
            name: '변경된 검증 장소',
            address: '대한민국 서울특별시',
            categoryLabel: '공공기관',
            location: { latitude: 37.5665, longitude: 126.978 },
            attributes: { businessStatus: 'closed' },
            confidence: 0.9,
          },
        }),
      }],
      now: () => new Date(thirdAt),
      leaseMilliseconds: 60_000,
      maximumAttempts: 3,
      retryBaseMilliseconds: 30_000,
    })
    const changed = await changedWorker.runOne()
    assert.equal(changed.status, 'completed')

    const history = await database.administratorClient.query(
      `SELECT detail.source_observation_id, detail.previous_source_observation_id,
              detail.change_kind, observation.payload_checksum
       FROM ingestion.provider_place_detail_observations AS detail
       JOIN ingestion.source_observations AS observation
         ON observation.id = detail.source_observation_id
       WHERE detail.provider_key = 'naver'
         AND detail.provider_place_id = 'naver-place-fixture'
       ORDER BY detail.normalized_at, detail.source_observation_id`,
    )
    assert.equal(history.rows.length, 3)
    assert.deepEqual(history.rows.map((row) => row.change_kind), [
      'initial', 'unchanged', 'changed',
    ])
    assert.equal(history.rows[0].previous_source_observation_id, null)
    assert.equal(
      history.rows[1].previous_source_observation_id,
      history.rows[0].source_observation_id,
    )
    assert.equal(
      history.rows[2].previous_source_observation_id,
      history.rows[1].source_observation_id,
    )
    assert.deepEqual(history.rows.map((row) => row.payload_checksum), [
      'b'.repeat(64), 'b'.repeat(64), 'c'.repeat(64),
    ])

    const parserDriftAt = '2026-09-20T04:00:00.000Z'
    assert.equal(await details.scheduleStale({
      providerKeys: ['naver'],
      staleBefore: '2026-09-13T04:00:00.000Z',
      scheduledAt: parserDriftAt,
      limit: 10,
    }), 1)
    const parserDriftClaim = await details.claimNext({
      workerId: 'provider-detail-parser-drift-worker',
      providerKeys: ['naver'],
      claimedAt: parserDriftAt,
      leaseUntil: '2026-09-20T04:01:00.000Z',
    })
    assert.ok(parserDriftClaim)
    await details.finishFailure({
      claim: parserDriftClaim,
      code: 'provider-parser-drift',
      retryable: false,
      finishedAt: parserDriftAt,
    })
    assert.equal(await details.scheduleStale({
      providerKeys: ['naver'],
      staleBefore: '2027-09-21T04:00:00.000Z',
      scheduledAt: '2027-09-22T04:00:00.000Z',
      limit: 10,
    }), 0)

    const transientFailureAt = '2026-09-22T04:00:00.000Z'
    await database.pool.query(
      `INSERT INTO ingestion.provider_place_detail_jobs (
         id, provider_key, provider_place_id, state, available_at,
         observation_id, candidate_id, created_at, updated_at
       ) VALUES (
         gen_random_uuid(), 'naver', 'naver-place-fixture', 'queued', $1::timestamptz,
         gen_random_uuid(), gen_random_uuid(), $1::timestamptz, $1::timestamptz
       )`,
      [transientFailureAt],
    )
    const transientClaim = await details.claimNext({
      workerId: 'provider-detail-transient-failure-worker',
      providerKeys: ['naver'],
      claimedAt: transientFailureAt,
      leaseUntil: '2026-09-22T04:01:00.000Z',
    })
    assert.ok(transientClaim)
    await details.finishFailure({
      claim: transientClaim,
      code: 'provider-unavailable',
      retryable: false,
      finishedAt: transientFailureAt,
    })
    const challengeAt = '2026-09-24T04:00:00.000Z'
    assert.equal(await details.scheduleStale({
      providerKeys: ['naver'],
      staleBefore: '2026-09-23T04:00:00.000Z',
      scheduledAt: challengeAt,
      limit: 10,
    }), 1)
    const challengeClaim = await details.claimNext({
      workerId: 'provider-detail-challenge-worker',
      providerKeys: ['naver'],
      claimedAt: challengeAt,
      leaseUntil: '2026-09-24T04:01:00.000Z',
    })
    assert.ok(challengeClaim)
    await details.finishFailure({
      claim: challengeClaim,
      code: 'provider-interaction-required',
      retryable: false,
      finishedAt: challengeAt,
    })
    assert.equal(await details.scheduleStale({
      providerKeys: ['naver'],
      staleBefore: '2027-09-24T04:00:00.000Z',
      scheduledAt: '2027-09-25T04:00:00.000Z',
      limit: 10,
    }), 0)
    const finalState = await database.administratorClient.query(
      `SELECT status, last_detail_observation_id,
              (SELECT count(*)::int FROM places.canonical_places) AS canonical_places
       FROM ingestion.provider_place_detail_statuses
       WHERE provider_key = 'naver' AND provider_place_id = 'naver-place-fixture'`,
    )
    assert.deepEqual(finalState.rows, [{
      status: 'available',
      last_detail_observation_id: history.rows[2].source_observation_id,
      canonical_places: 0,
    }])
  } finally {
    await database.close()
  }
})
