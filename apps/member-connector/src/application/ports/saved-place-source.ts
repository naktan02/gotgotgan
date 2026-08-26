import type { ConnectorProviderKey } from '@place/contracts/connector'

export type SavedPlaceCapturePayload = Readonly<{
  itemCount: number
  payload: string
}>

export interface SavedPlaceSource {
  readonly providerKey: ConnectorProviderKey
  collect(input: Readonly<{
    signal: AbortSignal
  }>): AsyncIterable<SavedPlaceCapturePayload>
}
