import { placeMatchPolicyVersion } from '../domain/assess-place-match.js'
import type { PlaceClusterProviderCell } from '../domain/cluster-model.js'
import { proposePlaceClusters } from '../domain/propose-place-clusters.js'
import type { PlaceClusterProposalStore } from './ports/place-cluster-proposal-store.js'

function providerCells(
  members: Parameters<typeof proposePlaceClusters>[0]['members'],
): readonly PlaceClusterProviderCell[] {
  const grouped = new Map<string, Array<{
    externalPlaceId: string
    sourceObservationId: string
  }>>()
  for (const member of members) {
    const group = grouped.get(member.providerIdentity.providerKey) ?? []
    group.push({
      externalPlaceId: member.providerIdentity.externalPlaceId,
      sourceObservationId: member.sourceObservationId,
    })
    grouped.set(member.providerIdentity.providerKey, group)
  }
  return [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([providerKey, providerMembers]) => ({ providerKey, members: providerMembers }))
}

export function createPlaceClusterProposer(dependencies: Readonly<{
  store: PlaceClusterProposalStore
  now: () => Date
  nextId: () => string
}>) {
  return {
    async propose() {
      const graph = await dependencies.store.loadGraph(placeMatchPolicyVersion)
      const proposals = proposePlaceClusters({
        ...graph,
        assessmentPolicyVersion: placeMatchPolicyVersion,
        proposedAt: dependencies.now().toISOString(),
        nextId: dependencies.nextId,
      })
      const persisted = await dependencies.store.recordProposals(proposals)
      return {
        status: 'shadow-proposed' as const,
        proposals: proposals.map((proposal, index) => {
          const persistence = persisted[index]
          if (persistence === undefined || persistence.requestedProposalId !== proposal.proposalId) {
            throw new Error('Place Cluster Proposal persistence result is out of order.')
          }
          return {
            proposalId: persistence.proposalId,
            proposalVersion: persistence.proposalVersion,
            persistence: persistence.status,
            memberCount: proposal.members.length,
            providerCells: providerCells(proposal.members),
          }
        }),
      }
    },
  }
}
