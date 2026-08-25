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
export { resolveCanonicalPlace } from './application/resolve-canonical-place.js'
export { resolveProviderPlaceIdentity } from './application/resolve-provider-place-identity.js'
export type { CanonicalResolutionStore } from './application/ports/canonical-resolution-store.js'
export { PostgresCanonicalResolutionStore } from './adapters/persistence/postgres-canonical-resolution-store.js'
