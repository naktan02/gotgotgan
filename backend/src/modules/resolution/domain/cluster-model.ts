import type { MatchClassification, ProviderPlaceIdentity } from './model.js'

export const placeClusterPolicyVersion = 'place-cluster-proposal.v1'
export const placeClusterProposalVersion = 1

export type ClusterEvidenceMember = Readonly<{
  sourceObservationId: string
  providerIdentity: ProviderPlaceIdentity
}>

export type ClusterAssessmentEvidence = Readonly<{
  leftObservationId: string
  rightObservationId: string
  assessmentPolicyVersion: string
  classification: MatchClassification
  confidence: number
  fingerprint: string
}>

export type ClusterAssessmentReference = Readonly<{
  leftObservationId: string
  rightObservationId: string
  assessmentPolicyVersion: string
  fingerprint: string
}>

export type PlaceClusterProposal = Readonly<{
  proposalId: string
  proposalVersion: number
  clusterPolicyVersion: string
  mode: 'shadow'
  members: readonly ClusterEvidenceMember[]
  supportingAssessments: readonly ClusterAssessmentReference[]
  proposedAt: string
  fingerprint: string
}>

export type PlaceClusterProviderCell = Readonly<{
  providerKey: string
  members: readonly Readonly<{
    externalPlaceId: string
    sourceObservationId: string
  }>[]
}>

export class InvalidClusterGraphError extends Error {
  override readonly name = 'InvalidClusterGraphError'
}

export class PlaceClusterProposalConflictError extends Error {
  override readonly name = 'PlaceClusterProposalConflictError'
}
