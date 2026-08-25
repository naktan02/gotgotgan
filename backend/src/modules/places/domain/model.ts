export type CanonicalPlaceStatus = 'active' | 'redirected' | 'retired'

export type CanonicalPlaceRecord = {
  id: string
  status: CanonicalPlaceStatus
}

export type ProviderPlaceIdentity = Readonly<{
  providerKey: string
  externalPlaceId: string
}>

export type CanonicalResolutionCommand =
  | Readonly<{ kind: 'create-place'; placeId: string; providerIdentity: ProviderPlaceIdentity }>
  | Readonly<{ kind: 'link-provider-identity'; targetPlaceId: string; providerIdentity: ProviderPlaceIdentity }>
  | Readonly<{ kind: 'merge-places'; sourcePlaceId: string; targetPlaceId: string }>
  | Readonly<{
      kind: 'split-provider-identity'
      sourcePlaceId: string
      newPlaceId: string
      providerIdentity: ProviderPlaceIdentity
    }>
  | Readonly<{ kind: 'retire-place'; placeId: string }>

export type CanonicalResolutionAttempt = Readonly<{
  decisionId: string
  sourceDecisionId: string
  command: CanonicalResolutionCommand
  policyVersion: string
  occurredAt: string
  fingerprint: string
}>

export type CanonicalResolutionOutcome = Readonly<{
  status:
    | 'applied'
    | 'replayed'
    | 'conflict'
    | 'invalid'
    | 'not-found'
    | 'not-active'
    | 'identity-already-linked'
    | 'identity-not-linked'
}>

export type CanonicalPlaceResolution =
  | Readonly<{ status: 'active'; placeId: string; redirectedFrom: readonly string[] }>
  | Readonly<{ status: 'retired'; placeId: string; redirectedFrom: readonly string[] }>
  | Readonly<{ status: 'not-found' }>

export type ProviderIdentityResolution =
  | Readonly<{ status: 'linked'; placeId: string }>
  | Readonly<{ status: 'not-found' }>

export class InvalidCanonicalResolutionError extends Error {
  override readonly name = 'InvalidCanonicalResolutionError'
}

export class CanonicalResolutionConflictError extends Error {
  override readonly name = 'CanonicalResolutionConflictError'
}
