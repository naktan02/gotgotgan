import type {
  ClusterAssessmentEvidence,
  ClusterEvidenceMember,
  PlaceClusterProposal,
} from '../../domain/cluster-model.js'

export type ClusterProposalPersistence = Readonly<{
  requestedProposalId: string
  proposalId: string
  proposalVersion: number
  status: 'recorded' | 'replayed'
}>

export interface PlaceClusterProposalStore {
  loadGraph(assessmentPolicyVersion: string): Promise<Readonly<{
    members: readonly ClusterEvidenceMember[]
    assessments: readonly ClusterAssessmentEvidence[]
  }>>
  recordProposals(
    proposals: readonly PlaceClusterProposal[],
  ): Promise<readonly ClusterProposalPersistence[]>
}
