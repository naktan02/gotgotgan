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
