import { describe, expect, it } from 'vitest'

import {
  createPlaceClusterProposer,
  placeClusterPolicyVersion,
  type ClusterAssessmentEvidence,
  type ClusterEvidenceMember,
  type PlaceClusterProposal,
  type PlaceClusterProposalStore,
} from '../index.js'

const at = '2026-08-28T09:00:00.000Z'
const observations = {
  naver: '01993050-0000-7000-8000-000000000001',
  google: '01993050-0000-7000-8000-000000000002',
  kakao: '01993050-0000-7000-8000-000000000003',
}

const members: readonly ClusterEvidenceMember[] = [
  {
    sourceObservationId: observations.naver,
    providerIdentity: { providerKey: 'naver', externalPlaceId: 'naver-place' },
  },
  {
    sourceObservationId: observations.google,
    providerIdentity: { providerKey: 'google', externalPlaceId: 'google-place' },
  },
  {
    sourceObservationId: observations.kakao,
    providerIdentity: { providerKey: 'kakao', externalPlaceId: 'kakao-place' },
  },
]

function edge(
  first: keyof typeof observations,
  second: keyof typeof observations,
  classification: ClusterAssessmentEvidence['classification'],
  confidence: number,
): ClusterAssessmentEvidence {
  const orderedObservations = [observations[first], observations[second]].sort()
  const leftObservationId = orderedObservations[0]!
  const rightObservationId = orderedObservations[1]!
  return {
    leftObservationId,
    rightObservationId,
    assessmentPolicyVersion: 'cross-provider-place-match.v1',
    classification,
    confidence,
    fingerprint: `${first.charCodeAt(0).toString(16)}${second.charCodeAt(0).toString(16)}`
      .padEnd(64, '0'),
  }
}

function storeFixture(assessments: readonly ClusterAssessmentEvidence[]) {
  const stored = new Map<string, PlaceClusterProposal>()
  const store: PlaceClusterProposalStore = {
    loadGraph: async () => ({ members, assessments }),
    recordProposals: async (proposals) => proposals.map((proposal) => {
      const existing = stored.get(proposal.fingerprint)
      if (existing === undefined) stored.set(proposal.fingerprint, proposal)
      return {
        requestedProposalId: proposal.proposalId,
        proposalId: existing?.proposalId ?? proposal.proposalId,
        proposalVersion: existing?.proposalVersion ?? proposal.proposalVersion,
        status: existing === undefined ? 'recorded' as const : 'replayed' as const,
      }
    }),
  }
  return { store, stored }
}

function ids(...values: string[]) {
  const remaining = [...values]
  return () => {
    const value = remaining.shift()
    if (value === undefined) throw new Error('No proposal identity remains')
    return value
  }
}

describe('shadow Place Cluster Proposal interface', () => {
  it('does not turn an incomplete A-B-C chain into a transitive cluster', async () => {
    const fixture = storeFixture([
      edge('naver', 'google', 'likely-same', 0.9),
      edge('google', 'kakao', 'likely-same', 0.8),
    ])
    const result = await createPlaceClusterProposer({
      store: fixture.store,
      now: () => new Date(at),
      nextId: ids(
        '01993050-1000-7000-8000-000000000001',
        '01993050-1000-7000-8000-000000000002',
      ),
    }).propose()

    expect(result.status).toBe('shadow-proposed')
    expect(result.proposals).toHaveLength(2)
    expect(result.proposals.map((proposal) => proposal.memberCount).sort()).toEqual([1, 2])
    expect(result.proposals.find((proposal) => proposal.memberCount === 2)?.providerCells)
      .toEqual([
        { providerKey: 'google', members: [{ externalPlaceId: 'google-place', sourceObservationId: observations.google }] },
        { providerKey: 'naver', members: [{ externalPlaceId: 'naver-place', sourceObservationId: observations.naver }] },
      ])
  })

  it('keeps a hard negative outside even when two positive edges point through it', async () => {
    const fixture = storeFixture([
      edge('naver', 'google', 'likely-same', 0.9),
      edge('google', 'kakao', 'likely-same', 0.8),
      edge('naver', 'kakao', 'likely-different', 0.99),
    ])
    const result = await createPlaceClusterProposer({
      store: fixture.store,
      now: () => new Date(at),
      nextId: ids(
        '01993050-2000-7000-8000-000000000001',
        '01993050-2000-7000-8000-000000000002',
      ),
    }).propose()

    expect(result.proposals.map((proposal) => proposal.memberCount).sort()).toEqual([1, 2])
    expect([...fixture.stored.values()].flatMap((proposal) => proposal.supportingAssessments))
      .toHaveLength(1)
  })

  it('records a complete clique once and replays it under a later generated identity', async () => {
    const fixture = storeFixture([
      edge('naver', 'google', 'likely-same', 0.9),
      edge('naver', 'kakao', 'likely-same', 0.85),
      edge('google', 'kakao', 'likely-same', 0.8),
    ])
    const first = await createPlaceClusterProposer({
      store: fixture.store,
      now: () => new Date(at),
      nextId: ids('01993050-3000-7000-8000-000000000001'),
    }).propose()
    const replay = await createPlaceClusterProposer({
      store: fixture.store,
      now: () => new Date('2026-08-28T09:05:00.000Z'),
      nextId: ids('01993050-3000-7000-8000-000000000002'),
    }).propose()

    expect(first.proposals).toEqual([
      expect.objectContaining({
        proposalVersion: 1,
        persistence: 'recorded',
        memberCount: 3,
      }),
    ])
    expect(replay.proposals).toEqual([
      expect.objectContaining({
        proposalId: first.proposals[0]?.proposalId,
        persistence: 'replayed',
        memberCount: 3,
      }),
    ])
    expect([...fixture.stored.values()][0]).toMatchObject({
      clusterPolicyVersion: placeClusterPolicyVersion,
      mode: 'shadow',
      supportingAssessments: expect.arrayContaining([
        expect.objectContaining({ leftObservationId: observations.naver }),
      ]),
    })
  })
})
