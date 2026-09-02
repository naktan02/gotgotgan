export {
  CanonicalResolutionConflictError,
  InvalidCanonicalResolutionError,
  type CanonicalPlaceRecord,
  type CanonicalPlaceResolution,
  type CanonicalPlaceStatus,
  type CanonicalResolutionAttempt,
  type CanonicalResolutionCommand,
  type CanonicalResolutionOutcome,
  type ProviderPlaceIdentity,
  type ProviderIdentityResolution,
} from './domain/model.js'
export { applyCanonicalResolution } from './application/apply-canonical-resolution.js'
export {
  resolvePlaceReference,
  type PlaceReference,
} from './application/resolve-place-reference.js'
export type { CanonicalResolutionStore } from './application/ports/canonical-resolution-store.js'
export { PostgresCanonicalResolutionStore } from './adapters/persistence/postgres-canonical-resolution-store.js'
export {
  createPlaceDetailReader,
  type PlaceDetailReader,
} from './application/read-place-detail.js'
export type {
  PlaceDetail,
  PlaceDetailDocument,
  PlaceDetailPersonalSource,
  PlaceDetailReadResult,
  PlaceDetailVisitSummary,
} from './domain/place-detail.js'
export {
  registerPlaceHttpRoutes,
  type PlaceHttpDependencies,
} from './transport/http/register-place-http.js'
export {
  createCanonicalPlaceKnowledge,
  type CanonicalPlaceKnowledge,
} from './application/catalog-canonical-place-knowledge.js'
export type {
  CanonicalAssertionAppendAttempt,
  CanonicalAssertionAppendStoreResult,
  CanonicalPlaceKnowledgeStore,
  CanonicalProfilePublishAttempt,
} from './application/ports/catalog-place-knowledge-store.js'
export { InvalidCanonicalPlaceKnowledgeInputError } from './domain/validate-catalog-place-knowledge.js'
export type {
  AreaAssignment,
  AreaAssignmentRole,
  CanonicalCurrentProfile,
  CanonicalFact,
  CanonicalFactAssertion,
  CanonicalFactAssertionBatch,
  CanonicalFactAssertionResult,
  CanonicalKnowledgeSubject,
  CanonicalKnowledgeActor,
  CanonicalKnowledgeWriteContext,
  CanonicalKnowledgeValidationIssue,
  CanonicalMediaFactValue,
  CanonicalMediaReference,
  CanonicalPlaceProfileContent,
  CanonicalProfilePublishRejection,
  CanonicalProfilePublishResult,
  CanonicalProfileReadResult,
  CanonicalIdentityState,
  DayOfWeek,
  GeographicLocation,
  LocalizedTextFactValue,
  MediaAttribution,
  MediaRightsState,
  OpeningHoursFactValue,
  OpeningMoment,
  OpeningHoursPeriod,
  OperationalStatus,
  OperationalStatusFactValue,
  PhoneFactValue,
  ProfileAreaAssignment,
  ProfileTaxonomyAssignment,
  PublishCanonicalPlaceProfile,
  SelectedFact,
  TaxonomyAssignment,
  TaxonomyAssignmentRole,
  WebsiteFactValue,
} from './domain/catalog-place-knowledge.js'
