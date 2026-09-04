export type VerifiedSourcePlaceMaterialization = Readonly<{
  decisionId: string
  proposedPlaceId: string
  providerKey: string
  providerPlaceId: string
  sourceObservationId: string
  placeCandidateId: string
  occurredAt: string
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
