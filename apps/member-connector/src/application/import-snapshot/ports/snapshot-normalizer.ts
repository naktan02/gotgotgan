import type { ConnectorCaptureChunkPayloadV2 } from '@place/contracts/transfers'

import type { SavedPlaceCapturePayload } from '../../ports/saved-place-source.js'

/** Provider Adapter seam that removes Provider payload shapes from snapshot orchestration. */
export interface SavedPlaceSnapshotNormalizer {
  readonly providerKey: 'naver' | 'kakao' | 'google'
  normalize(capture: SavedPlaceCapturePayload): ConnectorCaptureChunkPayloadV2
}
