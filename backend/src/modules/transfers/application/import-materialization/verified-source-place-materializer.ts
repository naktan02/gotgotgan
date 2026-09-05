export type VerifiedSourcePlaceMaterialization = Readonly<{
  decisionId: string
  proposedPlaceId: string
  providerKey: string
  providerPlaceId: string
  sourceObservationId: string
  placeCandidateId: string
  occurredAt: string
  snapshotEvidence?: Readonly<{
    acquisitionKind: 'documented-api' | 'account-export' | 'structured-web' |
      'browser-network' | 'browser-dom' | 'manual-capture'
    parserVersion: string
    payloadChecksum: string
    observedAt: string
    acquiredAt: string
    name: string
    address: string | null
    categoryLabel: string | null
    location: Readonly<{ latitude: number; longitude: number }> | null
  }>
}>

export class SourcePlaceMaterializationError extends Error {
  override readonly name = 'SourcePlaceMaterializationError'

  constructor(message: string, readonly retryable: boolean) {
    super(message)
  }
}

export interface VerifiedSourcePlaceMaterializerPort {
  materialize(input: VerifiedSourcePlaceMaterialization): Promise<Readonly<{ placeId: string }>>
}
