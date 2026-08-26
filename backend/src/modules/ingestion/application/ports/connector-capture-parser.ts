import type { ConnectorProviderKey } from '@place/contracts/connector'

import type { ConnectedPlaceItem } from './connected-place-source.js'

export type ConnectorCaptureParseResult =
  | Readonly<{ kind: 'page'; items: readonly ConnectedPlaceItem[]; nextCursor: string | null }>
  | Readonly<{ kind: 'rejected' }>

export interface ConnectorCaptureParser {
  readonly providerKey: ConnectorProviderKey
  readonly parserVersion: string
  readonly acquisitionKind: 'browser-network' | 'browser-dom'
  parse(input: Readonly<{
    body: Uint8Array
    contentType: 'application/json'
    observedAt: string
  }>): ConnectorCaptureParseResult
}
