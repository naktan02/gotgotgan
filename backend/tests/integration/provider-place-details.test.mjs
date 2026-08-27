import assert from 'node:assert/strict'
import test from 'node:test'

import { startPreparedPlaceDatabase } from './support/prepared-place-database.mjs'

test('provider detail jobs record normalized evidence without mutating canonical places', { timeout: 90_000 }, async () => {
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

    const worker = ingestion.createProviderPlaceDetailWorker({
      workerId: 'provider-detail-integration-worker',
      store: new ingestion.PostgresProviderPlaceDetails(database.pool),
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
      retryDelayMilliseconds: () => 30_000,
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
  } finally {
    await database.close()
  }
})
