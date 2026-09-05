import type { ConnectorCaptureChunkPayloadV2 } from '@place/contracts/transfers'
import type { ConnectorProviderKey } from '@place/contracts/connector'

import type { SavedPlaceCapturePayload } from '../../ports/saved-place-source.js'

/** Provider Adapter seam that removes Provider payload shapes from snapshot orchestration. */
export interface SavedPlaceSnapshotNormalizer {
  readonly providerKey: ConnectorProviderKey
  readonly parserVersion: string
  normalize(capture: SavedPlaceCapturePayload): ConnectorCaptureChunkPayloadV2
}
