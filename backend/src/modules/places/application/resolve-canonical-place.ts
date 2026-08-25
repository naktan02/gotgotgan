import type { CanonicalResolutionStore } from './ports/canonical-resolution-store.js'

export function resolveCanonicalPlace(input: Readonly<{
  placeId: string
  store: CanonicalResolutionStore
}>) {
  return input.store.resolve(input.placeId)
}
