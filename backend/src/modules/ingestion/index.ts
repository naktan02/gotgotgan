export {
  acquisitionKinds,
  IngestionIdConflictError,
  InvalidIngestionRecordError,
  type AcquisitionKind,
  type GeoPoint,
  type IngestionRecord,
  type PlaceCandidateRecord,
  type ResolutionDecision,
  type ResolutionDecisionRecord,
  type SourceObservationRecord,
} from './domain/model.js'
export { recordSourceObservation } from './application/record-source-observation.js'
export { recordPlaceCandidate } from './application/record-place-candidate.js'
export { recordResolutionDecision } from './application/record-resolution-decision.js'
export type { IngestionStore } from './application/ports/ingestion-store.js'
export { PostgresIngestionStore } from './adapters/persistence/postgres-ingestion-store.js'
