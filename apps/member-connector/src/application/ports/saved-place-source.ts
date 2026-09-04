import type { ConnectorProviderKey } from '@place/contracts/connector'

export type SavedPlaceCapturePayload = Readonly<{
  itemCount: number
  payload: string
}>

export type SavedPlaceSourceFailure =
  | 'permission-denied'
  | 'provider-drift'
  | 'provider-unavailable'
  | 'reauth-required'

export class SavedPlaceSourceError extends Error {
  constructor(
    readonly code: SavedPlaceSourceFailure,
    readonly retryable: boolean,
    message: string,
  ) {
    super(message)
    this.name = 'SavedPlaceSourceError'
  }
}

export interface SavedPlaceSource {
  readonly providerKey: ConnectorProviderKey
  collect(input: Readonly<{
    signal: AbortSignal
  }>): AsyncIterable<SavedPlaceCapturePayload>
}
