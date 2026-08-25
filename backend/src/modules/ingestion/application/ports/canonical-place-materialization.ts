export type SuggestedProviderIdentity = Readonly<{
  providerKey: string
  externalPlaceId: string
}>

export type SuggestedPlaceCanonicalCommand =
  | Readonly<{
      kind: 'create-place'
      placeId: string
      providerIdentity: SuggestedProviderIdentity
    }>
  | Readonly<{
      kind: 'link-provider-identity'
      targetPlaceId: string
      providerIdentity: SuggestedProviderIdentity
    }>

export interface CanonicalPlaceMaterializationPort {
  resolveProviderIdentity(
    identity: SuggestedProviderIdentity,
  ): Promise<Readonly<{ status: 'linked'; placeId: string }> | Readonly<{ status: 'not-found' }>>

  apply(input: Readonly<{
    decisionId: string
    sourceDecisionId: string
    command: SuggestedPlaceCanonicalCommand
    policyVersion: string
    occurredAt: string
  }>): Promise<Readonly<{
    status:
      | 'applied'
      | 'replayed'
      | 'conflict'
      | 'invalid'
      | 'not-found'
      | 'not-active'
      | 'identity-already-linked'
      | 'identity-not-linked'
  }>>
}
