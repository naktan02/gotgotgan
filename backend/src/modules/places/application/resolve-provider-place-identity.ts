import type { ProviderPlaceIdentity } from '../domain/model.js'
import type { CanonicalResolutionStore } from './ports/canonical-resolution-store.js'

export function resolveProviderPlaceIdentity(input: Readonly<{
  providerIdentity: ProviderPlaceIdentity
  store: CanonicalResolutionStore
}>) {
  return input.store.resolveProviderIdentity(input.providerIdentity)
}
