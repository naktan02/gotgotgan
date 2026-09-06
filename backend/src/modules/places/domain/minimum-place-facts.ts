/** Normalized venue facts only. A member's bookmark alias, list, notes and tags never belong here. */
export type MinimumPlaceFacts = Readonly<{
  schemaVersion: 'minimum-place-facts.v1'
  name: string
  address: string | null
  location: Readonly<{ latitude: number; longitude: number }> | null
}>

export type MinimumPlacePublication = Readonly<{
  placeId: string
  providerKey: string
  externalPlaceId: string
  sourceObservationId: string
  observedAt: string
  recordedAt: string
  facts: MinimumPlaceFacts
  /** Explicit disclosure policy, not a claim to a provider's content licence. */
  publicationBasis: 'provider-listed-facts' | 'member-approved-legacy-facts'
}>

export type CurrentMinimumPlace = Readonly<{
  placeId: string
  revision: number
  name: string
  address: string | null
  location: Readonly<{ latitude: number; longitude: number }> | null
  publishedAt: string
  policyVersion: string
  taxonomyReferences: readonly Readonly<{ key: string; version: number; role: 'primary' | 'secondary' | 'attribute' }>[]
}>
