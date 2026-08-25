import type { CanonicalResolutionStore } from './ports/canonical-resolution-store.js'

export type PlaceReference =
  | Readonly<{
      schemaVersion: 'place-reference.v1'
      status: 'available'
      placeId: string
    }>
  | Readonly<{
      schemaVersion: 'place-reference.v1'
      status: 'unavailable' | 'redacted'
    }>

type Input = Readonly<{
  placeId: string
  disclosure: 'allowed' | 'denied'
  store: CanonicalResolutionStore
}>

export async function resolvePlaceReference(input: Input): Promise<PlaceReference> {
  if (input.disclosure === 'denied') {
    return { schemaVersion: 'place-reference.v1', status: 'redacted' }
  }
  const resolution = await input.store.resolve(input.placeId)
  return resolution.status === 'active'
    ? { schemaVersion: 'place-reference.v1', status: 'available', placeId: resolution.placeId }
    : { schemaVersion: 'place-reference.v1', status: 'unavailable' }
}
