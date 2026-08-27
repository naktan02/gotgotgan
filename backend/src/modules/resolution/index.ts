export { createPlaceIdentityResolver } from './application/evaluate-place-identity.js'
export { createPlaceClusterProposer } from './application/propose-shadow-place-clusters.js'
export type {
  ClusterProposalPersistence,
  PlaceClusterProposalStore,
} from './application/ports/place-cluster-proposal-store.js'
export type {
  AssessmentAppendResult,
  EvidenceIndexResult,
  PlaceIdentityResolutionStore,
} from './application/ports/place-identity-resolution-store.js'
export { placeMatchPolicyVersion } from './domain/assess-place-match.js'
export {
  InvalidClusterGraphError,
  PlaceClusterProposalConflictError,
  placeClusterPolicyVersion,
  placeClusterProposalVersion,
} from './domain/cluster-model.js'
export type {
  ClusterAssessmentEvidence,
  ClusterAssessmentReference,
  ClusterEvidenceMember,
  PlaceClusterProposal,
  PlaceClusterProviderCell,
} from './domain/cluster-model.js'
export {
  InvalidPlaceEvidenceError,
  MatchAssessmentConflictError,
  PlaceEvidenceConflictError,
} from './domain/model.js'
export type {
  GeoPoint,
  MatchAssessment,
  MatchClassification,
  MatchFeatureVector,
  MatchReason,
  NormalizedNameRepresentation,
  NormalizedPlaceIdentityEvidence,
  PlaceEvidenceName,
  PlaceIdentityEvidence,
  ProviderPlaceIdentity,
} from './domain/model.js'
export { PostgresPlaceIdentityResolution } from './adapters/persistence/postgres-place-identity-resolution.js'
export { PostgresPlaceClusterProposals } from './adapters/persistence/postgres-place-cluster-proposals.js'
