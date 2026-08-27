import assert from 'node:assert/strict'
import test from 'node:test'

import { startPreparedPlaceDatabase } from './support/prepared-place-database.mjs'

const at = '2026-08-28T10:00:00.000Z'
const observations = {
  naver: '01993060-0000-7000-8000-000000000001',
  google: '01993060-0000-7000-8000-000000000002',
  kakao: '01993060-0000-7000-8000-000000000003',
}

function nextId(values) {
  const remaining = [...values]
  return () => {
    const value = remaining.shift()
    if (value === undefined) throw new Error('No proposal identity remains')
    return value
  }
}

test('shadow clusters are normalized, replay-safe, and reject unsafe transitive merging', { timeout: 90_000 }, async () => {
  const database = await startPreparedPlaceDatabase('place-cluster-proposals')
  try {
    const ingestion = await import('../../dist/modules/ingestion/index.js')
    const resolution = await import('../../dist/modules/resolution/index.js')
    const ingestionStore = new ingestion.PostgresIngestionStore(database.pool)
    const identityStore = new resolution.PostgresPlaceIdentityResolution(database.pool)

    async function observe({ id, providerKey, externalPlaceId, name, checksum }) {
      await ingestion.recordSourceObservation({
        id,
        providerKey,
        externalPlaceId,
        acquisitionKind: 'documented-api',
        payloadChecksum: checksum,
        parserVersion: `${providerKey}-fixture.v1`,
        observedAt: at,
        acquiredAt: at,
        facts: { name },
        confidence: 0.9,
        store: ingestionStore,
      })
    }

    const resolver = resolution.createPlaceIdentityResolver({
      store: identityStore,
      now: () => new Date(at),
    })
    const evidence = [
      {
        sourceObservationId: observations.naver,
        providerIdentity: { providerKey: 'naver', externalPlaceId: 'naver-civic-hall' },
        names: [{ text: '서울시민청', languageTag: 'ko' }],
        floor: '2층',
      },
      {
        sourceObservationId: observations.google,
        providerIdentity: { providerKey: 'google', externalPlaceId: 'google-civic-hall' },
        names: [{ text: 'Seoul Citizens Hall', languageTag: 'en' }],
      },
      {
        sourceObservationId: observations.kakao,
        providerIdentity: { providerKey: 'kakao', externalPlaceId: 'kakao-civic-hall' },
        names: [{ text: 'ソウル市民庁', languageTag: 'ja' }],
        floor: '3층',
      },
    ].map((item) => ({
      ...item,
      observedAt: at,
      phone: '+82 2-120-0000',
      location: { latitude: 37.5665, longitude: 126.978 },
    }))

    for (const [index, item] of evidence.entries()) {
      await observe({
        id: item.sourceObservationId,
        providerKey: item.providerIdentity.providerKey,
        externalPlaceId: item.providerIdentity.externalPlaceId,
        name: item.names[0].text,
        checksum: (index + 1).toString(16).repeat(64),
      })
      await resolver.evaluate(item)
    }

    const assessmentState = await database.administratorClient.query(`
      SELECT classification, count(*)::int AS count
      FROM resolution.match_assessments
      GROUP BY classification ORDER BY classification
    `)
    assert.deepEqual(assessmentState.rows, [
      { classification: 'likely-different', count: 1 },
      { classification: 'likely-same', count: 2 },
    ])

    const clusterStore = new resolution.PostgresPlaceClusterProposals(database.pool)
    const first = await resolution.createPlaceClusterProposer({
      store: clusterStore,
      now: () => new Date(at),
      nextId: nextId([
        '01993060-1000-7000-8000-000000000001',
        '01993060-1000-7000-8000-000000000002',
      ]),
    }).propose()

    assert.deepEqual(first, {
      status: 'shadow-proposed',
      proposals: [
        {
          proposalId: '01993060-1000-7000-8000-000000000001',
          proposalVersion: 1,
          persistence: 'recorded',
          memberCount: 2,
          providerCells: [
            {
              providerKey: 'google',
              members: [{
                externalPlaceId: 'google-civic-hall',
                sourceObservationId: observations.google,
              }],
            },
            {
              providerKey: 'naver',
              members: [{
                externalPlaceId: 'naver-civic-hall',
                sourceObservationId: observations.naver,
              }],
            },
          ],
        },
        {
          proposalId: '01993060-1000-7000-8000-000000000002',
          proposalVersion: 1,
          persistence: 'recorded',
          memberCount: 1,
          providerCells: [
            {
              providerKey: 'kakao',
              members: [{
                externalPlaceId: 'kakao-civic-hall',
                sourceObservationId: observations.kakao,
              }],
            },
          ],
        },
      ],
    })

    const replay = await resolution.createPlaceClusterProposer({
      store: clusterStore,
      now: () => new Date('2026-08-28T10:05:00.000Z'),
      nextId: nextId([
        '01993060-2000-7000-8000-000000000001',
        '01993060-2000-7000-8000-000000000002',
      ]),
    }).propose()
    assert.deepEqual(
      replay.proposals.map(({ proposalId, persistence }) => ({ proposalId, persistence })),
      first.proposals.map(({ proposalId }) => ({ proposalId, persistence: 'replayed' })),
    )

    const state = await database.administratorClient.query(`
      SELECT
        (SELECT count(*)::int FROM resolution.place_cluster_proposals) AS proposals,
        (SELECT count(*)::int FROM resolution.place_cluster_members) AS members,
        (SELECT count(*)::int FROM resolution.place_cluster_assessments) AS assessment_links,
        (SELECT count(*)::int FROM places.canonical_places) AS canonical_places,
        (SELECT count(*)::int FROM information_schema.columns
          WHERE table_schema = 'resolution'
            AND table_name IN (
              'place_cluster_proposals', 'place_cluster_members', 'place_cluster_assessments'
            )
            AND column_name ~ '(naver|google|kakao|tabelog)') AS provider_columns
    `)
    assert.deepEqual(state.rows, [{
      proposals: 2,
      members: 3,
      assessment_links: 1,
      canonical_places: 0,
      provider_columns: 0,
    }])

    const singleton = first.proposals.find((proposal) => proposal.memberCount === 1)
    assert.ok(singleton)
    await assert.rejects(
      database.pool.query(
        `INSERT INTO resolution.place_cluster_assessments (
           proposal_id, proposal_version, left_observation_id,
           right_observation_id, assessment_policy_version
         ) VALUES ($1::uuid,$2,$3::uuid,$4::uuid,$5)`,
        [
          singleton.proposalId,
          singleton.proposalVersion,
          observations.naver,
          observations.google,
          resolution.placeMatchPolicyVersion,
        ],
      ),
      (error) => error?.code === '23503',
    )
    await assert.rejects(
      database.pool.query(`UPDATE resolution.place_cluster_proposals SET mode = 'shadow'`),
      (error) => error?.code === '42501',
    )
    await assert.rejects(
      database.pool.query(`DELETE FROM resolution.place_cluster_members`),
      (error) => error?.code === '42501',
    )
  } finally {
    await database.close()
  }
})
