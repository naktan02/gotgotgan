import type {
  MatchAssessment,
  NormalizedPlaceIdentityEvidence,
} from '../../domain/model.js'

export type EvidenceIndexResult = 'recorded' | 'replayed' | 'stale' | 'conflict'
export type AssessmentAppendResult = 'recorded' | 'replayed' | 'conflict'

export interface PlaceIdentityResolutionStore {
  indexEvidence(input: Readonly<{
    evidence: NormalizedPlaceIdentityEvidence
    indexedAt: string
  }>): Promise<EvidenceIndexResult>
  findCandidates(input: Readonly<{
    evidence: NormalizedPlaceIdentityEvidence
    maximumCandidates: number
    maximumDistanceMeters: number
    nameSimilarityThreshold: number
    addressSimilarityThreshold: number
  }>): Promise<readonly NormalizedPlaceIdentityEvidence[]>
  appendAssessment(assessment: MatchAssessment): Promise<AssessmentAppendResult>
}
