import type {
  CanonicalPlaceResolution,
  CanonicalResolutionAttempt,
  CanonicalResolutionOutcome,
  ProviderIdentityResolution,
  ProviderPlaceIdentity,
} from '../../domain/model.js'

export interface CanonicalResolutionStore {
  apply(attempt: CanonicalResolutionAttempt): Promise<CanonicalResolutionOutcome>
  resolve(placeId: string): Promise<CanonicalPlaceResolution>
  resolveProviderIdentity(identity: ProviderPlaceIdentity): Promise<ProviderIdentityResolution>
}
